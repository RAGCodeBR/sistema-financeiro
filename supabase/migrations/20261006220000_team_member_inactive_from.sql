-- Notas da equipe: inativar um colaborador a partir de um mês (YYYY-MM).
-- Desse mês em diante ele deixa de ser cobrado; as notas antigas continuam.
alter table public.team_members
  add column if not exists inactive_from text;

alter table public.team_members
  drop constraint if exists team_members_inactive_from_check;
alter table public.team_members
  add constraint team_members_inactive_from_check
  check (inactive_from is null or inactive_from ~ '^[0-9]{4}-[0-9]{2}$');
