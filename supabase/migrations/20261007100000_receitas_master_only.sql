-- Receitas e clientes/pagadores são exclusivos do Master.
-- Os demais usuários continuam limitados aos seus centros de custo e, dentro
-- deles, só podem ver, criar, editar e excluir DESPESAS e FORNECEDORES.
-- Regra aplicada no banco: vale mesmo para acessos fora da interface.

drop policy if exists "entries by unit" on public.entries;
create policy "entries by unit" on public.entries
  for all
  using (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()))
  with check (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()));

drop policy if exists "counterparties by unit" on public.counterparties;
create policy "counterparties by unit" on public.counterparties
  for all
  using (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()))
  with check (public.can_access_unit(unit) and (kind = 'despesa' or public.is_master()));
