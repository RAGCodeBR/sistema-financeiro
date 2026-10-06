-- Corrige lançamentos de parcelamentos/recorrências que "transbordaram" de mês.
--
-- Bug: ao criar uma série com vencimento no dia 29, 30 ou 31, o cálculo de
-- data usava Date#setMonth e os meses curtos pulavam para o mês seguinte
-- (ex.: 31/07 + 2 meses = 01/10 em vez de 30/09; 30/01 + 1 mês = 02/03).
-- Resultado: um mês ficava sem lançamento e o seguinte ficava com dois.
--
-- Regra (só lançamentos ainda previstos): um lançamento de série no dia 1–3,
-- que não está no primeiro mês da série, divide o mês com outro lançamento da
-- mesma série e cujo mês anterior ficou vazio, volta para o último dia do mês
-- anterior. Séries legítimas com dois pagamentos por mês (adiantamento +
-- salário) não são afetadas, pois têm lançamento em todos os meses.
-- É idempotente: depois de aplicada, nenhuma linha atende mais à regra.

update public.entries e
set date = (date_trunc('month', e.date) - interval '1 day')::date
where e.series_id is not null
  and e.status = 'previsto'
  and extract(day from e.date) <= 3
  and date_trunc('month', e.date) > (
    select date_trunc('month', min(f.date))
    from public.entries f
    where f.series_id = e.series_id
  )
  and exists (
    select 1 from public.entries o
    where o.series_id = e.series_id
      and o.id <> e.id
      and date_trunc('month', o.date) = date_trunc('month', e.date)
  )
  and not exists (
    select 1 from public.entries p
    where p.series_id = e.series_id
      and date_trunc('month', p.date) = date_trunc('month', e.date) - interval '1 month'
  );
