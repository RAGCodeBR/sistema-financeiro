-- Permissão opcional de consulta a receitas. O marcador fica em allowed_units,
-- mas não representa um centro de custo e não concede escrita nem acesso Master.
create or replace function public.can_view_income()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'master' or '__income_read__' = any(allowed_units))
  )
$$;

-- A política FOR ALL existente continua limitando escrita a despesas ou Master.
-- Políticas SELECT são combinadas com OR, liberando apenas leitura das receitas
-- nos centros já autorizados para o usuário.
drop policy if exists "income entries read by unit" on public.entries;
create policy "income entries read by unit" on public.entries
  for select to authenticated
  using (kind = 'receita' and public.can_access_unit(unit) and public.can_view_income());

drop policy if exists "income counterparties read by unit" on public.counterparties;
create policy "income counterparties read by unit" on public.counterparties
  for select to authenticated
  using (kind = 'receita' and public.can_access_unit(unit) and public.can_view_income());
