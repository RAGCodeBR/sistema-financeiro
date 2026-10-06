-- Notas da equipe: colaboradores que enviam nota fiscal todo mês e as notas
-- recebidas. Acesso restrito ao Master e a quem tem a flag '__team_notes__'.

create or replace function public.can_view_team_notes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or '__team_notes__' = any(allowed_units))
  )
$$;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  service text not null default '',
  document text not null default '',
  email text not null default '',
  expected_amount numeric(14,2) check (expected_amount is null or expected_amount >= 0),
  due_day integer not null default 5 check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.team_invoices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members (id) on delete cascade,
  competence text not null check (competence ~ '^[0-9]{4}-[0-9]{2}$'),
  invoice_number text not null default '',
  amount numeric(14,2) check (amount is null or amount >= 0),
  issue_date date,
  files text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (member_id, competence)
);

alter table public.team_members enable row level security;
alter table public.team_invoices enable row level security;

drop policy if exists "team members by permission" on public.team_members;
create policy "team members by permission" on public.team_members
  for all using (public.can_view_team_notes()) with check (public.can_view_team_notes());

drop policy if exists "team invoices by permission" on public.team_invoices;
create policy "team invoices by permission" on public.team_invoices
  for all using (public.can_view_team_notes()) with check (public.can_view_team_notes());

grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.team_invoices to authenticated;

-- Cofre privado só para as notas (10 MB, PDF/PNG/JPG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-notes', 'team-notes', false, 10485760,
        array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "team notes files read" on storage.objects;
create policy "team notes files read" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-notes' and public.can_view_team_notes());

drop policy if exists "team notes files insert" on storage.objects;
create policy "team notes files insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-notes' and public.can_view_team_notes());

drop policy if exists "team notes files update" on storage.objects;
create policy "team notes files update" on storage.objects
  for update to authenticated
  using (bucket_id = 'team-notes' and public.can_view_team_notes());

drop policy if exists "team notes files delete" on storage.objects;
create policy "team notes files delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-notes' and public.can_view_team_notes());
