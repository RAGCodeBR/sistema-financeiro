-- Prepared locally. Apply explicitly; building the frontend does not run SQL.
begin;

create table if not exists public.card_import_statements (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  card_key text not null, card_last4 text not null check (card_last4 ~ '^[0-9]{4}$'),
  bank_code text not null, due_date date not null, metadata jsonb not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.card_import_items (
  source_key jsonb primary key,
  statement_fingerprint text not null references public.card_import_statements(fingerprint),
  card_key text not null, due_date date not null, purchase_date date not null,
  description text not null, raw_cents bigint not null, net_cents bigint not null default 0 check (net_cents >= 0),
  status text not null check (status in ('pending', 'unrecognized', 'created', 'linked', 'offset')),
  nature text check (nature in ('PF', 'PJ')), unit text, category text, note text not null default '',
  entry_id uuid references public.entries(id) on delete set null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique (entry_id), check (jsonb_typeof(source_key) = 'array')
);
create index if not exists card_import_items_card_due on public.card_import_items(card_key, due_date);
alter table public.entries add column if not exists expense_nature text check (expense_nature in ('PF', 'PJ'));
alter table public.entries add column if not exists purchase_date date;
alter table public.entries add column if not exists card_key text;
alter table public.entries add column if not exists card_last4 text;
alter table public.entries add column if not exists card_source_key jsonb;
create unique index if not exists entries_card_source_key on public.entries(card_source_key) where card_source_key is not null;

alter table public.card_import_statements enable row level security;
alter table public.card_import_items enable row level security;
create policy "card statements read by importer" on public.card_import_statements for select to authenticated
  using (created_by = auth.uid() or public.is_master());
create policy "card items read by permission" on public.card_import_items for select to authenticated
  using (public.is_master() or (unit is not null and public.can_access_unit(unit)) or (unit is null and created_by = auth.uid()));
grant select on public.card_import_statements, public.card_import_items to authenticated;

create or replace function public.confirm_card_statement(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid(); meta jsonb := payload->'statement'; item jsonb; old_item public.card_import_items%rowtype;
  card text := meta->>'card_key'; last4 text := meta->>'card_last4'; due date := (meta->>'due_date')::date;
  fp text := meta->>'fingerprint'; total bigint; paid_sum bigint; paid_on date; payment_status text := 'previsto';
  entry_uuid uuid; new_entry public.entries%rowtype; linked public.entries%rowtype;
  seen jsonb := '{}'; base_key jsonb; expected_key jsonb; ordinal integer; raw bigint; net bigint; decision text;
  already integer := 0; settled integer := 0; created jsonb := '[]'; applied jsonb := '[]'; observed jsonb := '[]'; old_meta public.card_import_statements%rowtype;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor) then raise exception 'Sessão não autorizada'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 5000 then raise exception 'Itens de fatura inválidos'; end if;
  if fp is null or fp !~ '^[a-f0-9]{64}$' or card is null or card !~ '^[a-z0-9-]{2,40}:[0-9X]{4,24}$' or last4 is null or last4 !~ '^[0-9]{4}$' or right(card, 4) <> last4 or due is null or meta->>'bank_code' is null or split_part(card, ':', 1) <> meta->>'bank_code' then raise exception 'Cartão, banco ou vencimento inválido'; end if;
  if meta->'warnings' is distinct from '[]'::jsonb then raise exception 'Revise as divergências da leitura antes de criar lançamentos'; end if;
  perform pg_advisory_xact_lock(hashtextextended(card || ':' || due::text, 0));
  select * into old_meta from public.card_import_statements where fingerprint = fp;
  if found and (old_meta.card_key <> card or old_meta.due_date <> due or old_meta.metadata is distinct from meta) then raise exception 'A mesma fatura foi apresentada com dados financeiros diferentes'; end if;

  -- Check identity, per-unit permission and values before making any mutation.
  for item in select value from jsonb_array_elements(payload->'items') loop
    raw := (item->>'amount_cents')::bigint; net := (item->>'net_cents')::bigint; decision := item->>'status';
    if raw is null or abs(raw) > 999999999999 or net is null or net < 0 or net > greatest(raw, 0) or (item->>'date')::date is null or length(btrim(item->>'description')) not between 1 and 300 or length(coalesce(item->>'note', '')) > 1000 then raise exception 'Valor, data ou descrição de item inválido'; end if;
    if coalesce(item->>'kind' not in ('purchase', 'fee', 'credit'), true) or (raw < 0 and item->>'kind' <> 'credit') or (raw > 0 and item->>'kind' = 'credit') or coalesce(decision not in ('pending', 'unrecognized', 'classified', 'linked'), true) then raise exception 'Tipo ou situação de item inválido'; end if;
    base_key := jsonb_build_array(card, due::text, item->>'kind', ((item->>'date')::date)::text, upper(regexp_replace(btrim(item->>'description'), '\s+', ' ', 'g')), raw, coalesce(item->>'installment', ''));
    ordinal := coalesce((seen->>(base_key::text))::integer, 0) + 1;
    seen := jsonb_set(seen, array[base_key::text], to_jsonb(ordinal));
    expected_key := base_key || jsonb_build_array(ordinal);
    if item->'source_key' is distinct from expected_key then raise exception 'Identificador de origem da compra inválido'; end if;
    select * into old_item from public.card_import_items where source_key = expected_key;
    if found and old_item.status in ('created', 'linked', 'offset') then
      if not public.can_access_unit(old_item.unit) then raise exception 'Um item já foi importado em um centro sem acesso nesta sessão'; end if;
      if old_item.status in ('created', 'linked') and old_item.entry_id is null then raise exception 'Um lançamento de origem foi removido. Revise o histórico antes de reimportar'; end if;
      continue;
    end if;
    if found and old_item.created_by <> actor and not public.is_master() then raise exception 'Uma conferência deste item já pertence a outro usuário'; end if;
    if decision in ('classified', 'linked') then
      if coalesce(item->>'nature' not in ('PJ', 'PF'), true) or not coalesce(public.can_access_unit(item->>'unit'), false) then raise exception 'Sem permissão para o centro de custo informado'; end if;
      if decision = 'classified' and (not exists (select 1 from public.categories where kind = 'despesa' and unit = item->>'unit' and name = item->>'category') or not exists (select 1 from public.accounts where unit = item->>'unit' and name = item->>'unit')) then raise exception 'Categoria ou conta indisponível no centro de custo'; end if;
      if decision = 'linked' then
        select * into linked from public.entries where id = (item->>'linked_entry_id')::uuid;
        if not found or linked.kind <> 'despesa' or not public.can_access_unit(linked.unit) or linked.unit <> item->>'unit' or linked.category <> item->>'category' or round(linked.amount * 100) <> raw or raw <= 0 then raise exception 'O lançamento vinculado não corresponde à compra ou não está acessível'; end if;
        if exists (select 1 from public.card_import_items where entry_id = linked.id and source_key <> expected_key) then raise exception 'O lançamento já está vinculado a outra compra'; end if;
      elsif raw > 0 and not coalesce((item->>'confirmed_new')::boolean, false) and exists (
        select 1 from public.entries e where e.kind = 'despesa' and public.can_access_unit(e.unit)
        and ((round(e.amount * 100) = raw and abs(coalesce(e.purchase_date, e.date) - (item->>'date')::date) <= 7)
          or (upper(regexp_replace(btrim(e.description), '\s+', ' ', 'g')) = upper(regexp_replace(btrim(item->>'description'), '\s+', ' ', 'g')) and abs(coalesce(e.purchase_date, e.date) - (item->>'date')::date) <= 3))
        and (e.card_last4 is null or e.card_last4 = last4)
      ) then raise exception 'Há lançamento com mesmo valor e data próxima. Confirme o vínculo ou que se trata de uma nova despesa'; end if;
    elsif net <> 0 then raise exception 'Item pendente não pode criar despesa'; end if;
  end loop;
  select sum((value->>'amount_cents')::bigint) into total from jsonb_array_elements(payload->'items');
  if total is distinct from (meta->>'current_total_cents')::bigint then raise exception 'A soma dos itens não fecha com a fatura'; end if;
  if meta->>'previous_balance_cents' is not null and meta->>'payments_total_cents' is not null and meta->>'invoice_total_cents' is not null and
    (meta->>'previous_balance_cents')::bigint + (meta->>'payments_total_cents')::bigint + total <> (meta->>'invoice_total_cents')::bigint then raise exception 'Saldo, pagamentos e movimentações não fecham com a fatura'; end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'items') x
    where x->>'status' = 'classified' and not exists (select 1 from public.card_import_items i where i.source_key = x->'source_key' and i.status in ('created','linked','offset'))
    group by x->>'nature', x->>'unit', x->>'category'
    having sum((x->>'amount_cents')::bigint) <> sum((x->>'net_cents')::bigint)
  ) then raise exception 'Créditos e valores líquidos não fecham no mesmo grupo PJ/PF, centro e categoria'; end if;
  if exists (select 1 from jsonb_array_elements(payload->'items') x where (x->>'amount_cents')::bigint < 0 and x->>'status' in ('pending','unrecognized') and not exists (select 1 from public.card_import_items i where i.source_key = x->'source_key' and i.status in ('created','linked','offset'))) then raise exception 'Classifique os créditos antes de gerar despesas'; end if;

  -- A due date in the past never proves payment. Require the full equation
  -- and the detailed payments, independently of the client's status hint.
  select sum((p->>'amount_cents')::bigint), max((p->>'date')::date) into paid_sum, paid_on
    from jsonb_array_elements(coalesce(meta->'payment_items', '[]')) p where (p->>'amount_cents')::bigint < 0;
  if (meta->>'invoice_total_cents')::bigint = 0 and total > 0 and (meta->>'previous_balance_cents')::bigint + total > 0
    and paid_sum = (meta->>'payments_total_cents')::bigint and -paid_sum >= (meta->>'previous_balance_cents')::bigint + total then payment_status := 'realizado';
  else paid_on := null; end if;
  insert into public.card_import_statements(fingerprint, card_key, card_last4, bank_code, due_date, metadata, created_by)
    values(fp, card, last4, meta->>'bank_code', due, meta, actor) on conflict do nothing;

  for item in select value from jsonb_array_elements(payload->'items') loop
    select * into old_item from public.card_import_items where source_key = item->'source_key';
    if found and old_item.status in ('created','linked','offset') then
      already := already + 1;
      applied := applied || jsonb_build_array(to_jsonb(old_item));
      if old_item.entry_id is not null then
        select * into linked from public.entries where id = old_item.entry_id;
        if old_item.status = 'created' and payment_status = 'realizado' and linked.status = 'previsto' then
          if not public.can_access_unit(linked.unit) or linked.kind <> 'despesa' or linked.unit <> old_item.unit or linked.category <> old_item.category or round(linked.amount * 100) <> old_item.net_cents then raise exception 'Um lançamento importado foi alterado. Revise a baixa antes de confirmar o pagamento'; end if;
          update public.entries set status = 'realizado', paid_date = paid_on where id = old_item.entry_id returning * into linked;
          settled := settled + 1;
        end if;
        observed := observed || jsonb_build_array(to_jsonb(linked));
      end if;
      continue;
    end if;
    raw := (item->>'amount_cents')::bigint; net := (item->>'net_cents')::bigint; decision := item->>'status'; entry_uuid := null;
    if decision = 'linked' then entry_uuid := (item->>'linked_entry_id')::uuid; select * into linked from public.entries where id = entry_uuid; observed := observed || jsonb_build_array(to_jsonb(linked));
    elsif decision = 'classified' and net > 0 then
      insert into public.entries(kind, unit, account, category, description, beneficiary, pix, amount, date, status, recurrence, installments, installment, notes, paid_date, expense_nature, purchase_date, card_key, card_last4, card_source_key)
      values ('despesa', item->>'unit', item->>'unit', item->>'category', item->>'description', item->>'description', '', net::numeric / 100, due, payment_status, 'nenhuma',
        case when item->>'installment' ~ '^[0-9]{1,2}/[0-9]{1,2}$' then greatest(1, split_part(item->>'installment', '/', 2)::integer) else 1 end,
        nullif(item->>'installment', ''), concat_ws(E'\n', nullif(item->>'note', ''), 'Cartão ' || last4 || ' | compra ' || (item->>'date'), case when raw > net then 'Créditos abatidos (centavos): ' || (raw-net)::text end),
        paid_on, item->>'nature', (item->>'date')::date, card, last4, item->'source_key') returning * into new_entry;
      entry_uuid := new_entry.id; created := created || jsonb_build_array(to_jsonb(new_entry));
    end if;
    insert into public.card_import_items(source_key, statement_fingerprint, card_key, due_date, purchase_date, description, raw_cents, net_cents, status, nature, unit, category, note, entry_id, created_by)
      values(item->'source_key', fp, card, due, (item->>'date')::date, item->>'description', raw, net,
        case when decision = 'classified' then case when net > 0 then 'created' else 'offset' end when decision = 'linked' then 'linked' else decision end,
        nullif(item->>'nature',''), nullif(item->>'unit',''), nullif(item->>'category',''), coalesce(item->>'note',''), entry_uuid, actor)
      on conflict(source_key) do update set statement_fingerprint = excluded.statement_fingerprint, net_cents = excluded.net_cents, status = excluded.status, nature = excluded.nature, unit = excluded.unit, category = excluded.category, note = excluded.note, entry_id = excluded.entry_id
      returning * into old_item;
    if decision in ('classified','linked') then applied := applied || jsonb_build_array(to_jsonb(old_item)); end if;
  end loop;
  return jsonb_build_object('created_entries', created, 'existing_entries', observed, 'applied', applied, 'already_applied_count', already, 'settled_count', settled);
end;
$$;
revoke all on function public.confirm_card_statement(jsonb) from public, anon;
grant execute on function public.confirm_card_statement(jsonb) to authenticated;
commit;
