-- Fincore: initial production schema
-- Run this once in Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Usuário Fincore',
  email text,
  role text not null default 'operador' check (role in ('master', 'operador')),
  allowed_units text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  created_at timestamptz not null default now(),
  unique (name, unit)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('receita', 'despesa')),
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  icon text,
  color text,
  created_at timestamptz not null default now(),
  unique (name, kind, unit)
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  series_id uuid,
  kind text not null check (kind in ('receita', 'despesa')),
  unit text not null check (unit in ('Marketing', 'Sítio', 'Consultoria', 'Pessoa Física')),
  account text not null,
  category text not null,
  description text not null,
  beneficiary text not null default '',
  pix text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  status text not null default 'previsto' check (status in ('previsto', 'realizado')),
  recurrence text not null default 'nenhuma' check (recurrence in ('nenhuma', 'mensal')),
  installments integer not null default 1 check (installments >= 1),
  installment text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'Usuário Fincore'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_master()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'master') $$;

create or replace function public.can_access_unit(requested_unit text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or requested_unit = any(allowed_units))
  )
$$;

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.entries enable row level security;

drop policy if exists "profile read own" on public.profiles;
create policy "profile read own" on public.profiles for select using (id = auth.uid() or public.is_master());
drop policy if exists "profile update master" on public.profiles;
create policy "profile update master" on public.profiles for update using (public.is_master()) with check (public.is_master());

drop policy if exists "accounts by unit" on public.accounts;
create policy "accounts by unit" on public.accounts for all using (public.can_access_unit(unit)) with check (public.can_access_unit(unit));
drop policy if exists "categories by unit" on public.categories;
create policy "categories by unit" on public.categories for all using (public.can_access_unit(unit)) with check (public.can_access_unit(unit));
drop policy if exists "entries by unit" on public.entries;
create policy "entries by unit" on public.entries for all using (public.can_access_unit(unit)) with check (public.can_access_unit(unit));

insert into public.accounts (name, unit) values
  ('Marketing', 'Marketing'), ('Sítio', 'Sítio'), ('Consultoria', 'Consultoria'), ('Pessoa Física', 'Pessoa Física')
on conflict (name, unit) do nothing;

insert into public.categories (name, kind, unit, icon, color) values
  ('Honorários', 'receita', 'Consultoria', '💼', '#3b82f6'),
  ('Vendas', 'receita', 'Marketing', '📈', '#c026d3'),
  ('Produção', 'receita', 'Sítio', '🌱', '#059669'),
  ('Salário', 'receita', 'Pessoa Física', '💰', '#f59e0b'),
  ('Fornecedores', 'despesa', 'Consultoria', '🏭', '#ef4444'),
  ('Tráfego pago', 'despesa', 'Marketing', '📣', '#c026d3'),
  ('Insumos', 'despesa', 'Sítio', '🚜', '#059669'),
  ('Moradia', 'despesa', 'Pessoa Física', '🏠', '#f59e0b')
on conflict (name, kind, unit) do nothing;
