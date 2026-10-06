-- Bancos (qual banco pagou cada despesa) e desconto no pagamento.

create table if not exists public.banks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now()
);

create unique index if not exists banks_name_key on public.banks (lower(btrim(name)));

alter table public.banks enable row level security;

-- Todos os usuários logados podem escolher o banco; só o Master cadastra/edita.
drop policy if exists "banks readable" on public.banks;
create policy "banks readable" on public.banks
  for select to authenticated using (true);

drop policy if exists "banks managed by master" on public.banks;
create policy "banks managed by master" on public.banks
  for all to authenticated using (public.is_master()) with check (public.is_master());

grant select, insert, update, delete on public.banks to authenticated;

-- Excluir um banco não apaga despesas: elas só ficam sem banco.
alter table public.entries
  add column if not exists bank_id uuid references public.banks (id) on delete set null;

-- Desconto quando o valor pago é menor que o valor da conta.
alter table public.entries
  add column if not exists discount numeric(14,2) not null default 0 check (discount >= 0);
