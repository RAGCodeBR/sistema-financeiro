-- Permissão opcional para lançar e alterar receitas nos centros autorizados.
-- Não concede o papel Master nem acesso a bancos, usuários ou centros extras.
create or replace function public.can_manage_income()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or '__income_write__' = any(allowed_units))
  )
$$;

-- A política de consulta separada continua servindo usuários só de leitura.
-- A escrita de receitas exige o marcador próprio e o centro autorizado.
drop policy if exists "entries by unit" on public.entries;
create policy "entries by unit" on public.entries
  for all to authenticated
  using (public.can_access_unit(unit) and (kind = 'despesa' or public.can_manage_income()))
  with check (public.can_access_unit(unit) and (kind = 'despesa' or public.can_manage_income()));

drop policy if exists "counterparties by unit" on public.counterparties;
create policy "counterparties by unit" on public.counterparties
  for all to authenticated
  using (public.can_access_unit(unit) and (kind = 'despesa' or public.can_manage_income()))
  with check (public.can_access_unit(unit) and (kind = 'despesa' or public.can_manage_income()));
