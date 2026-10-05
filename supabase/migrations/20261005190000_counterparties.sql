-- Cadastro de fornecedores e clientes por centro de custo.
-- Esta migracao e local ate ser aplicada explicitamente ao Supabase.
create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('despesa', 'receita')),
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  name text not null check (length(btrim(name)) > 0),
  provides text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, unit, kind)
);

create unique index if not exists counterparties_name_unit_kind_key
  on public.counterparties (unit, kind, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

alter table public.counterparties enable row level security;
drop policy if exists "counterparties by unit" on public.counterparties;
create policy "counterparties by unit" on public.counterparties
  for all using (public.can_access_unit(unit))
  with check (public.can_access_unit(unit));
grant select, insert, update on public.counterparties to authenticated;

alter table public.entries add column if not exists counterparty_id uuid;

-- Names already typed in old launches become reusable records. Case-only
-- duplicates are collapsed within the same type and cost centre.
insert into public.counterparties (kind, unit, name)
select kind, unit, min(btrim(beneficiary))
from public.entries
where length(btrim(beneficiary)) > 0
group by kind, unit, lower(regexp_replace(btrim(beneficiary), '[[:space:]]+', ' ', 'g'))
on conflict do nothing;

update public.entries e
set counterparty_id = c.id
from public.counterparties c
where e.counterparty_id is null
  and e.unit = c.unit
  and e.kind = c.kind
  and lower(regexp_replace(btrim(e.beneficiary), '[[:space:]]+', ' ', 'g'))
    = lower(regexp_replace(btrim(c.name), '[[:space:]]+', ' ', 'g'));

-- A linked contact must belong to the entry's type and cost centre.
alter table public.entries
  add constraint entries_counterparty_unit_kind_fkey
  foreign key (counterparty_id, unit, kind)
  references public.counterparties (id, unit, kind);

-- Older browser builds still send the free-text beneficiary field. Keep them
-- compatible by registering that name automatically on subsequent writes.
create or replace function public.sync_entry_counterparty()
returns trigger language plpgsql security definer set search_path = public as $$
declare linked_name text;
begin
  if tg_op = 'UPDATE' then
    if new.beneficiary is distinct from old.beneficiary
       and new.counterparty_id is not distinct from old.counterparty_id then
      new.counterparty_id := null;
    end if;
  end if;

  if new.counterparty_id is not null then
    select name into linked_name from public.counterparties
    where id = new.counterparty_id and unit = new.unit and kind = new.kind;
    if not found then
      raise exception 'Fornecedor ou cliente não pertence a este centro de custo e tipo';
    end if;
    new.beneficiary := linked_name;
  elsif length(btrim(new.beneficiary)) > 0 then
    insert into public.counterparties (kind, unit, name)
    values (new.kind, new.unit, btrim(new.beneficiary))
    on conflict do nothing;
    select id into new.counterparty_id from public.counterparties
    where unit = new.unit and kind = new.kind
      and lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(btrim(new.beneficiary), '[[:space:]]+', ' ', 'g'));
  end if;
  return new;
end;
$$;

drop trigger if exists sync_entry_counterparty on public.entries;
create trigger sync_entry_counterparty
  before insert or update of beneficiary, counterparty_id, unit, kind
  on public.entries for each row execute function public.sync_entry_counterparty();

create or replace function public.sync_counterparty_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.entries set beneficiary = new.name where counterparty_id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_counterparty_name on public.counterparties;
create trigger sync_counterparty_name
  after update of name on public.counterparties
  for each row when (old.name is distinct from new.name)
  execute function public.sync_counterparty_name();
