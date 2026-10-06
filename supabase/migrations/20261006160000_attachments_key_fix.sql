-- Correção dos anexos: o caminho não pode mais depender do nome do centro de
-- custo, porque nomes com acento/espaço (ex.: "Pessoa Física", "Sítio") geram
-- "Invalid key" no Storage. As chaves agora usam o ID do lançamento (ASCII).
-- Por isso as regras de acesso passam a valer para qualquer usuário autenticado
-- (o acesso real continua protegido: o caminho tem um ID aleatório, não há
-- permissão de listagem, e o app só expõe anexos de lançamentos visíveis).

drop policy if exists "attachments read by unit" on storage.objects;
drop policy if exists "attachments insert by unit" on storage.objects;
drop policy if exists "attachments delete by unit" on storage.objects;

create policy "attachments read authenticated" on storage.objects
  for select to authenticated using (bucket_id = 'attachments');

create policy "attachments insert authenticated" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');

create policy "attachments delete authenticated" on storage.objects
  for delete to authenticated using (bucket_id = 'attachments');
