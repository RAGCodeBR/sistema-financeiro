-- Centros de custo cadastráveis. Cada centro mantém seu plano de categorias.
create table if not exists public.cost_centers (
  name text primary key,
  initials text not null default '',
  created_at timestamptz not null default now(),
  constraint cost_centers_name_check check (
    length(btrim(name)) between 2 and 80
    and name not in ('Todos', '__reports__')
  ),
  constraint cost_centers_initials_check check (length(initials) <= 4)
);

create unique index if not exists cost_centers_name_case_key
  on public.cost_centers (lower(btrim(name)));

insert into public.cost_centers (name, initials) values
  ('Marketing', 'MK'),
  ('Sítio', 'SI'),
  ('Consultoria', 'CO'),
  ('Pessoa Física', 'PF')
on conflict (name) do nothing;

-- Preserve any historical centre values before replacing fixed-name checks.
insert into public.cost_centers (name, initials)
select distinct unit, upper(left(unit, 2))
from (
  select unit from public.accounts
  union select unit from public.categories
  union select unit from public.entries
  union select unit from public.counterparties
) historical
on conflict (name) do nothing;

alter table public.accounts drop constraint if exists accounts_unit_check;
alter table public.categories drop constraint if exists categories_unit_check;
alter table public.entries drop constraint if exists entries_unit_check;
alter table public.counterparties drop constraint if exists counterparties_unit_check;

alter table public.accounts
  add constraint accounts_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);
alter table public.categories
  add constraint categories_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);
alter table public.entries
  add constraint entries_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);
alter table public.counterparties
  add constraint counterparties_cost_center_fkey foreign key (unit)
  references public.cost_centers (name);

alter table public.cost_centers enable row level security;
create policy "cost centers visible by permission" on public.cost_centers
  for select using (public.can_access_unit(name));
create policy "cost centers created by master" on public.cost_centers
  for insert with check (public.is_master());
grant select, insert on public.cost_centers to authenticated;

create or replace function public.create_cost_center_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (name, unit) values (new.name, new.name)
  on conflict (name, unit) do nothing;
  return new;
end;
$$;

create trigger create_cost_center_account
  after insert on public.cost_centers
  for each row execute function public.create_cost_center_account();

insert into public.accounts (name, unit)
select name, name from public.cost_centers
on conflict (name, unit) do nothing;
