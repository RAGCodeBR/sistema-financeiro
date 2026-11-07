import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildStatementImportPlan, identifyStatement, importPayload } from "../src/lib/cardImport.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
let db;
const tx = (id = "one", amountCents = 10000, extra = {}) => ({ id, date: "2026-11-02", description: "COMPRA EXEMPLO", amountCents, kind: amountCents < 0 ? "credit" : "purchase", page: 2, sourceLine: "teste", detail: "", ...extra });
const statement = (extra = {}) => ({ fingerprint: "a".repeat(64), fileName: "teste.pdf", pageCount: 2, dueDate: "2026-11-15", cardLast4: "5678", bankCode: "itau", maskedCardNumber: "1234XXXXXXXX5678", transactions: [tx()], currentTotalCents: 10000, invoiceTotalCents: 10000, previousBalanceCents: 0, paymentsTotalCents: 0, computedCurrentCents: 10000, warnings: [], ...extra });
const classified = (extra = {}) => ({ status: "classified", nature: "PJ", costCenter: "Consultoria", category: "Software", note: "", confirmedNew: true, ...extra });
const payload = (s = statement(), decisions = { one: classified() }) => importPayload(buildStatementImportPlan(s, decisions, []));
const confirm = async p => (await db.query("select public.confirm_card_statement($1::jsonb) result", [JSON.stringify(p)])).rows[0].result;
async function reset() { await db.exec("reset role; truncate public.card_refund_events, public.card_refund_reviews, public.card_import_items, public.card_import_statements, public.entries cascade; set role authenticated;"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]); }

before(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema extensions;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', encrypted_password text, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;`);
  let schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  schema = schema.replace("create extension if not exists pgcrypto;", "");
  await db.exec(schema);
  for (const name of ["20261005190000_counterparties.sql", "20261006150000_expense_interest.sql", "20261106190000_card_statement_import.sql", "20261106210000_card_refund_reviews.sql", "20261107120000_card_import_permissions.sql"]) {
    if (name === "20261106190000_card_statement_import.sql") await db.exec("alter default privileges in schema public grant all on tables to authenticated, anon");
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
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
test("Supabase default grants cannot expose or truncate the import ledger", async () => {
  await reset();
  for (const table of ["card_import_statements", "card_import_items", "card_refund_reviews", "card_refund_events"]) {
    const privileges = (await db.query(`select has_table_privilege('anon',$1,'SELECT') as anon_read, has_table_privilege('authenticated',$1,'SELECT') as auth_read,
      has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') as auth_write`, [`public.${table}`])).rows[0];
    assert.deepEqual(privileges, { anon_read: false, auth_read: true, auth_write: false });
    await assert.rejects(db.exec(`truncate public.${table} cascade`), /permission denied/);
  }
});

const refundKey = (s = statement(), index = 0) => JSON.parse(identifyStatement(s).transactions[index].sourceKey);
const recordRefund = async (extra = {}) => (await db.query("select public.record_card_refund($1::jsonb) result", [JSON.stringify({ source_key: refundKey(), amount_cents: 10000, refund_date: "2026-11-06", note: "Cancelamento confirmado", ...extra })])).rows[0].result;

test("SQL records an unrecognized purchase as refunded without creating or deleting financial entries", async () => {
  await reset(); await confirm(payload(statement(), { one: classified({ status: "unrecognized" }) }));
  const saved = await recordRefund();
  assert.equal(saved.amount_cents, 10000); assert.equal(saved.refund_date, "2026-11-06");
  assert.equal((await db.query("select count(*)::int n from public.entries")).rows[0].n, 0);
  // Even a stale browser trying to classify the purchase cannot create it.
  assert.equal((await confirm(payload())).created_entries.length, 0);
  assert.equal((await db.query("select count(*)::int n from public.card_refund_events")).rows[0].n, 1);
  await recordRefund();
  assert.equal((await db.query("select count(*)::int n from public.card_refund_events")).rows[0].n, 1);
});
test("SQL excludes a paired refund credit from unrelated expenses in the same invoice", async () => {
  await reset();
  const s = statement({ transactions: [tx(), tx("credit", -10000, { description: "ESTORNO" }), tx("other", 20000, { description: "OUTRA COMPRA" })], currentTotalCents: 20000, computedCurrentCents: 20000, invoiceTotalCents: 20000 });
  await recordRefund({ credit_source_key: refundKey(s, 1) });
  const result = await confirm(payload(s, { one: classified(), credit: classified(), other: classified() }));
  assert.equal(result.created_entries.length, 1);
  assert.equal(result.created_entries[0].description, "OUTRA COMPRA");
  assert.equal(result.created_entries[0].amount, 200);
});
test("SQL protects a linked credit in a later invoice and preserves signed invoice math", async () => {
  await reset();
  const next = statement({ fingerprint: "b".repeat(64), dueDate: "2026-12-15", transactions: [tx("credit", -10000, { description: "ESTORNO" }), tx("other", 20000, { description: "OUTRA COMPRA" })] });
  await recordRefund({ credit_source_key: refundKey(next, 0) });
  // A stale client that still allocates the credit must refresh its review.
  await assert.rejects(confirm(payload(next, { credit: classified(), other: classified() })), /líquidos/);
  const registered = { sourceKey: JSON.stringify(refundKey()), amountCents: 10000, date: "2026-11-06", note: "", creditSourceKey: JSON.stringify(refundKey(next, 0)) };
  const result = await confirm(importPayload(buildStatementImportPlan(next, { other: classified() }, [], [], [registered])));
  assert.equal(result.created_entries.length, 1); assert.equal(result.created_entries[0].amount, 200);
  assert.equal((await confirm(payload())).created_entries.length, 0);
  const bad = payload(next, { other: classified() }); bad.statement.current_total_cents = 20000;
  await assert.rejects(confirm(bad), /dados financeiros|soma/);
});
test("SQL rejects invalid refund amounts, dates, kinds and credits without partial state", async () => {
  await reset();
  await assert.rejects(recordRefund({ amount_cents: 5000 }), /integral/);
  await assert.rejects(recordRefund({ refund_date: "2026-11-01" }), /Data/);
  await assert.rejects(recordRefund({ source_key: refundKey(statement({ transactions: [tx("credit", -10000)] })) }), /origem/);
  const wrongCard = statement({ cardLast4: "9999", maskedCardNumber: "1234XXXXXXXX9999", transactions: [tx("credit", -10000)] });
  await assert.rejects(recordRefund({ credit_source_key: refundKey(wrongCard) }), /mesmo cartão/);
  assert.equal((await db.query("select count(*)::int n from public.card_refund_reviews")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.card_refund_events")).rows[0].n, 0);
});
test("SQL cannot mark a financial entry or a consumed credit as refunded", async () => {
  await reset(); await confirm(payload());
  await assert.rejects(recordRefund(), /processada/);
  await reset();
  const s = statement({ transactions: [tx(), tx("credit", -10000)] , currentTotalCents: 0, computedCurrentCents: 0, invoiceTotalCents: 0 });
  await confirm(payload(s, { one: classified(), credit: classified() }));
  const fresh = statement({ dueDate: "2026-12-15", fingerprint: "c".repeat(64) });
  await assert.rejects(recordRefund({ source_key: refundKey(fresh), credit_source_key: refundKey(s, 1) }), /crédito já foi processado/);
});
test("SQL prohibits double use of a refund credit and audits later linking", async () => {
  await reset();
  const credit = refundKey(statement({ dueDate: "2026-12-15", transactions: [tx("credit", -10000)] }));
  await recordRefund(); await recordRefund({ credit_source_key: credit });
  const otherPurchase = refundKey(statement({ transactions: [tx("other", 10000, { description: "OUTRA COMPRA" })] }));
  await assert.rejects(recordRefund({ source_key: otherPurchase, credit_source_key: credit }), /outra compra/);
  const events = (await db.query("select before_state,after_state from public.card_refund_events order by id")).rows;
  assert.equal(events.length, 2); assert.equal(events[0].before_state, null);
  assert.equal(events[1].before_state.credit_source_key, null); assert.deepEqual(events[1].after_state.credit_source_key, credit);
});
test("SQL refund records and their audit history are isolated by owner and reject direct writes", async () => {
  await reset(); await recordRefund();
  await assert.rejects(db.query("delete from public.card_refund_reviews"), /permission denied/);
  await assert.rejects(db.query("update public.card_refund_events set actor=$1", [otherId]), /permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherId]);
  assert.equal((await db.query("select * from public.card_refund_reviews")).rows.length, 0);
  assert.equal((await db.query("select * from public.card_refund_events")).rows.length, 0);
  await assert.rejects(recordRefund(), /outro usuário/);
  await assert.rejects(confirm(payload()), /outro usuário/);
});
