-- Juros e data de pagamento (baixa) nas despesas, para medir juros pagos
-- e tempo de atraso. Vencimento continua sendo a coluna "date".
alter table public.entries
  add column if not exists juros numeric(14,2) not null default 0 check (juros >= 0);
alter table public.entries
  add column if not exists paid_date date;
