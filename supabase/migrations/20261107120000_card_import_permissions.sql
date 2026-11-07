-- Supabase projects may grant ALL to anon/authenticated on newly created
-- public tables by default. RLS does not protect TRUNCATE, so explicitly
-- restrict the import ledger to authenticated reads and RPC-only writes.
begin;
revoke all on public.card_import_statements, public.card_import_items from public, anon, authenticated;
grant select on public.card_import_statements, public.card_import_items to authenticated;
commit;
