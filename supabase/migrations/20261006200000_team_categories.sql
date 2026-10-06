-- Categorias de colaboradores (ex.: Marketing, Analista de Sistemas, Financeiro,
-- Comercial) na aba Notas da equipe. Mesmo acesso das notas.

create table if not exists public.team_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now()
);

create unique index if not exists team_categories_name_key
  on public.team_categories (lower(btrim(name)));

alter table public.team_categories enable row level security;

drop policy if exists "team categories by permission" on public.team_categories;
create policy "team categories by permission" on public.team_categories
  for all using (public.can_view_team_notes()) with check (public.can_view_team_notes());

grant select, insert, update, delete on public.team_categories to authenticated;

-- Excluir uma categoria não apaga colaboradores: eles só ficam sem categoria.
alter table public.team_members
  add column if not exists category_id uuid references public.team_categories (id) on delete set null;
