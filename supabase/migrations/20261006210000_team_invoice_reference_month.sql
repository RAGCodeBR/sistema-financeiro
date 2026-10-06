-- Notas da equipe: separa o "mês de controle" (em que mês a nota aparece e
-- conta como enviada) da "competência" (mês do serviço, só informativo).
-- Ex.: nota recebida em março com competência fevereiro fica em março.

alter table public.team_invoices
  add column if not exists reference_month text;

-- Notas existentes continuam no mesmo mês em que já apareciam.
update public.team_invoices
set reference_month = competence
where reference_month is null;

-- Pedido do usuário: a nota de março da Carolina Avellar (competência
-- fevereiro, nº 2) deve ficar no controle de março.
update public.team_invoices i
set reference_month = '2026-03'
from public.team_members m
where m.id = i.member_id
  and m.name ilike 'carolina avellar%'
  and i.competence = '2026-02'
  and i.invoice_number = '2';

alter table public.team_invoices
  alter column reference_month set not null;

alter table public.team_invoices
  drop constraint if exists team_invoices_reference_month_check;
alter table public.team_invoices
  add constraint team_invoices_reference_month_check
  check (reference_month ~ '^[0-9]{4}-[0-9]{2}$');

-- Uma nota por colaborador por mês de controle (antes era por competência).
alter table public.team_invoices
  drop constraint if exists team_invoices_member_id_competence_key;
create unique index if not exists team_invoices_member_reference_key
  on public.team_invoices (member_id, reference_month);
