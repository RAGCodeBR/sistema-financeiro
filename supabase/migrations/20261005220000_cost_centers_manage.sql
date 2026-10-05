-- Permite editar (sigla/cor) e excluir centros de custo, com exclusão em cascata.

-- 1. Coluna de cor (guarda a chave da paleta usada no app, ex.: 'indigo').
alter table public.cost_centers
  add column if not exists color text not null default 'indigo';
alter table public.cost_centers
  drop constraint if exists cost_centers_color_check;
alter table public.cost_centers
  add constraint cost_centers_color_check check (length(color) <= 20);

-- Mantém a aparência atual dos centros originais.
update public.cost_centers set color = 'fuchsia' where name = 'Marketing';
update public.cost_centers set color = 'emerald' where name = 'Sítio';
update public.cost_centers set color = 'blue'    where name = 'Consultoria';
update public.cost_centers set color = 'amber'   where name = 'Pessoa Física';

-- 2. Exclusão em cascata: apagar um centro apaga contas, categorias,
--    lançamentos e favorecidos ligados a ele, de forma atômica.
alter table public.accounts drop constraint if exists accounts_cost_center_fkey;
alter table public.accounts
  add constraint accounts_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

alter table public.categories drop constraint if exists categories_cost_center_fkey;
alter table public.categories
  add constraint categories_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

alter table public.entries drop constraint if exists entries_cost_center_fkey;
alter table public.entries
  add constraint entries_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

alter table public.counterparties drop constraint if exists counterparties_cost_center_fkey;
alter table public.counterparties
  add constraint counterparties_cost_center_fkey foreign key (unit)
  references public.cost_centers (name) on delete cascade;

-- 3. Só o Master pode editar e excluir centros.
drop policy if exists "cost centers updated by master" on public.cost_centers;
create policy "cost centers updated by master" on public.cost_centers
  for update using (public.is_master()) with check (public.is_master());

drop policy if exists "cost centers removed by master" on public.cost_centers;
create policy "cost centers removed by master" on public.cost_centers
  for delete using (public.is_master());

grant update, delete on public.cost_centers to authenticated;
