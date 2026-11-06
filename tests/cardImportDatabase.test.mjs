import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildStatementImportPlan, importPayload } from "../src/lib/cardImport.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
let db;
const tx = (id = "one", amountCents = 10000, extra = {}) => ({ id, date: "2026-11-02", description: "COMPRA EXEMPLO", amountCents, kind: amountCents < 0 ? "credit" : "purchase", page: 2, sourceLine: "teste", detail: "", ...extra });
const statement = (extra = {}) => ({ fingerprint: "a".repeat(64), fileName: "teste.pdf", pageCount: 2, dueDate: "2026-11-15", cardLast4: "5678", bankCode: "itau", maskedCardNumber: "1234XXXXXXXX5678", transactions: [tx()], currentTotalCents: 10000, invoiceTotalCents: 10000, previousBalanceCents: 0, paymentsTotalCents: 0, computedCurrentCents: 10000, warnings: [], ...extra });
const classified = (extra = {}) => ({ status: "classified", nature: "PJ", costCenter: "Consultoria", category: "Software", note: "", confirmedNew: true, ...extra });
const payload = (s = statement(), decisions = { one: classified() }) => importPayload(buildStatementImportPlan(s, decisions, []));
const confirm = async p => (await db.query("select public.confirm_card_statement($1::jsonb) result", [JSON.stringify(p)])).rows[0].result;
async function reset() { await db.exec("reset role; truncate public.card_import_items, public.card_import_statements, public.entries cascade; set role authenticated;"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]); }

before(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema extensions;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', encrypted_password text, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;`);
  let schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  schema = schema.replace("create extension if not exists pgcrypto;", "");
  await db.exec(schema);
  for (const name of ["20261005190000_counterparties.sql", "20261006150000_expense_interest.sql", "20261106190000_card_statement_import.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'one@example.test'),($2,'two@example.test')", [userId, otherId]);
  await db.query("update public.profiles set allowed_units = array['Consultoria'] where id = $1", [userId]);
  await db.query("update public.profiles set allowed_units = array['Marketing'] where id = $1", [otherId]);
  await db.exec("insert into public.categories(name,kind,unit) values('Software','despesa','Consultoria'),('Tarifas e impostos','despesa','Consultoria'); grant select on public.entries to authenticated;");
});
after(async () => { await db?.close(); });

test("real SQL creates expenses atomically and keeps original purchase date and due date", async () => {
  await reset(); const result = await confirm(payload());
  assert.equal(result.created_entries.length, 1);
  assert.equal(result.created_entries[0].amount, 100);
  assert.equal(result.created_entries[0].date, "2026-11-15");
  assert.equal(result.created_entries[0].purchase_date, "2026-11-02");
  assert.equal(result.created_entries[0].status, "previsto");
});
test("SQL is idempotent across reimport and PDF revisions of the same card and cycle", async () => {
  await reset(); await confirm(payload());
  const retry = await confirm(payload());
  assert.equal(retry.created_entries.length, 0);
  assert.equal(retry.existing_entries.length, 1);
  assert.equal((await confirm(payload(statement({ fingerprint: "b".repeat(64) })))).created_entries.length, 0);
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 1);
});
test("SQL persists unrecognized purchases as review items without financial entries", async () => {
  await reset();
  const result = await confirm(payload(statement(), { one: classified({ status: "unrecognized", note: "Em apuração" }) }));
  assert.equal(result.created_entries.length, 0);
  const rows = (await db.query("select status,note from public.card_import_items")).rows;
  assert.deepEqual(rows, [{ status: "unrecognized", note: "Em apuração" }]);
});
test("an error during a later insert rolls back all financial entries and import metadata", async () => {
  await reset(); await db.exec("reset role");
  await db.exec(`create or replace function public.reject_test_entry() returns trigger language plpgsql as $$ begin if new.description = 'FAIL TEST' then raise exception 'simulated insert failure'; end if; return new; end $$;
    create trigger reject_test_entry before insert on public.entries for each row execute function public.reject_test_entry(); set role authenticated;`);
  const s = statement({ transactions: [tx(), tx("two", 20000, { description: "FAIL TEST" })], currentTotalCents: 30000, computedCurrentCents: 30000, invoiceTotalCents: 30000 });
  await assert.rejects(confirm(payload(s, { one: classified(), two: classified() })), /simulated insert failure/);
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.card_import_statements")).rows[0].n, 0);
  await db.exec("reset role; drop trigger reject_test_entry on public.entries;");
});
test("a deleted imported entry cannot be silently recreated by reimport", async () => {
  await reset(); const result = await confirm(payload());
  await db.exec("reset role"); await db.query("delete from public.entries where id=$1", [result.created_entries[0].id]); await db.exec("set role authenticated");
  await assert.rejects(confirm(payload()), /removido/);
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 0);
});
test("SQL isolates different cards with otherwise identical purchases", async () => {
  await reset(); await confirm(payload());
  const result = await confirm(payload(statement({ fingerprint: "c".repeat(64), cardLast4: "9999", maskedCardNumber: "1234XXXXXXXX9999" })));
  assert.equal(result.created_entries.length, 1);
});
test("SQL derives paid status from the document instead of a client flag", async () => {
  await reset();
  const s = statement({ invoiceTotalCents: 0, paymentsTotalCents: -10000, transactions: [tx(), tx("pay", -10000, { kind: "payment", date: "2026-11-05" })] });
  const result = await confirm(payload(s));
  assert.equal(result.created_entries[0].status, "realizado");
  assert.equal(result.created_entries[0].paid_date, "2026-11-05");
});
test("a later paid invoice settles unchanged imported expenses without duplicates", async () => {
  await reset(); await confirm(payload());
  const paid = statement({ fingerprint: "b".repeat(64), invoiceTotalCents: 0, paymentsTotalCents: -10000, transactions: [tx(), tx("pay", -10000, { kind: "payment", date: "2026-11-05" })] });
  const result = await confirm(payload(paid));
  assert.equal(result.created_entries.length, 0);
  assert.equal(result.settled_count, 1);
  assert.equal(result.existing_entries[0].status, "realizado");
  assert.equal(result.existing_entries[0].paid_date, "2026-11-05");
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 1);
});
test("automatic settlement refuses an amount manually changed after import", async () => {
  await reset(); const first = await confirm(payload());
  await db.exec("reset role"); await db.query("update public.entries set amount=101 where id=$1", [first.created_entries[0].id]); await db.exec("set role authenticated");
  const paid = statement({ fingerprint: "b".repeat(64), invoiceTotalCents: 0, paymentsTotalCents: -10000, transactions: [tx(), tx("pay", -10000, { kind: "payment", date: "2026-11-05" })] });
  await assert.rejects(confirm(payload(paid)), /alterado/);
  assert.equal((await db.query("select status from public.entries")).rows[0].status, "previsto");
});
test("SQL rejects unauthorized centers with no partial entry or statement saved", async () => {
  await reset();
  const s = statement({ transactions: [tx(), tx("two", 20000)], currentTotalCents: 30000, computedCurrentCents: 30000, invoiceTotalCents: 30000 });
  await assert.rejects(confirm(payload(s, { one: classified(), two: classified({ costCenter: "Marketing" }) })), /permissão/);
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 0);
});
test("SQL validates totals, source identities and credit allocation before writing", async () => {
  await reset(); const badTotal = payload(); badTotal.statement.current_total_cents = 999;
  await assert.rejects(confirm(badTotal), /soma/);
  const badKey = payload(); badKey.items[0].source_key[7] = 999;
  await assert.rejects(confirm(badKey), /Identificador/);
  const badNet = payload(); badNet.items[0].net_cents = 5000;
  await assert.rejects(confirm(badNet), /líquidos/);
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 0);
});
test("SQL applies credits without negative expenses or new income", async () => {
  await reset(); const s = statement({ transactions: [tx(), tx("fee", 6650, { kind: "fee" }), tx("credit", -6650)] });
  const result = await confirm(payload(s, { one: classified(), fee: classified({ category: "Tarifas e impostos" }), credit: classified({ category: "Tarifas e impostos" }) }));
  assert.equal(result.created_entries.length, 1);
  assert.equal(result.applied.filter(i => i.status === "offset").length, 2);
  assert.equal(result.created_entries[0].kind, "despesa");
});
test("SQL preserves explicit links and rejects linking the same entry twice", async () => {
  await reset();
  await db.exec("reset role");
  const existing = (await db.query("insert into public.entries(kind,unit,account,category,description,amount,date) values('despesa','Consultoria','Consultoria','Software','COMPRA EXEMPLO',100,'2026-11-02') returning id")).rows[0].id;
  await db.exec("set role authenticated");
  const result = await confirm(payload(statement(), { one: classified({ status: "linked", linkedEntryId: existing }) }));
  assert.equal(result.created_entries.length, 0);
  assert.equal(result.applied[0].entry_id, existing);
  const other = statement({ fingerprint: "d".repeat(64), cardLast4: "0000", maskedCardNumber: "1234XXXXXXXX0000" });
  await assert.rejects(confirm(payload(other, { one: classified({ status: "linked", linkedEntryId: existing }) })), /outra compra/);
});
test("import ledger is protected from direct writes and hidden across unauthorized centers", async () => {
  await reset(); await confirm(payload());
  await assert.rejects(db.query("delete from public.card_import_items"), /permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherId]);
  assert.equal((await db.query("select * from public.card_import_items")).rows.length, 0);
  await assert.rejects(confirm(payload()), /sem acesso/);
});
