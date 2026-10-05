-- Anexos nos lançamentos: cofre de arquivos (storage) + referência nos lançamentos.

-- 1. Campo que guarda os caminhos dos arquivos anexados a cada lançamento.
alter table public.entries
  add column if not exists attachments text[] not null default '{}';

-- 2. Bucket privado para os arquivos (10 MB por arquivo, só PDF/PNG/JPG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. Acesso aos arquivos segue o centro de custo: o caminho é
--    "<centro de custo>/<lançamento>/<arquivo>", e só quem tem acesso
--    àquele centro consegue ler, enviar ou apagar.
drop policy if exists "attachments read by unit" on storage.objects;
create policy "attachments read by unit" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.can_access_unit((storage.foldername(name))[1]));

drop policy if exists "attachments insert by unit" on storage.objects;
create policy "attachments insert by unit" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_access_unit((storage.foldername(name))[1]));

drop policy if exists "attachments delete by unit" on storage.objects;
create policy "attachments delete by unit" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.can_access_unit((storage.foldername(name))[1]));
