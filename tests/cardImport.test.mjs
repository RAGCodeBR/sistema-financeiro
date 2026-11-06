import assert from "node:assert/strict";
import test from "node:test";
import { buildStatementImportPlan, createLocalStatementEntries, getStatementPayment, identifyStatement, importPayload, statementCardKey } from "../src/lib/cardImport.ts";

export const transaction = (id = "one", amountCents = 10000, extra = {}) => ({ id, date: "2026-11-02", description: "COMPRA EXEMPLO", amountCents, kind: amountCents < 0 ? "credit" : "purchase", page: 2, sourceLine: "linha sintética", detail: "", ...extra });
export const statement = (extra = {}) => ({ fingerprint: "a".repeat(64), fileName: "teste.pdf", pageCount: 2, dueDate: "2026-11-15", cardLast4: "5678", bankCode: "itau", maskedCardNumber: "1234XXXXXXXX5678", transactions: [transaction()], currentTotalCents: 10000, invoiceTotalCents: 10000, previousBalanceCents: 0, paymentsTotalCents: 0, computedCurrentCents: 10000, warnings: [], ...extra });
export const classified = (extra = {}) => ({ status: "classified", nature: "PJ", costCenter: "Consultoria", category: "Software", note: "", ...extra });

test("payment is automatic only with balanced zero due and detailed payments", () => {
  const s = statement({ invoiceTotalCents: 0, paymentsTotalCents: -10000, transactions: [transaction(), transaction("pay", -10000, { kind: "payment", date: "2026-11-05" })] });
  assert.equal(getStatementPayment(s).entryStatus, "realizado");
  assert.equal(getStatementPayment(s).paidDate, "2026-11-05");
  assert.equal(getStatementPayment({ ...s, transactions: [transaction()] }).state, "unknown");
  assert.equal(getStatementPayment({ ...s, paymentsTotalCents: -5000 }).state, "unknown");
});
test("past due is never inferred as paid, and new expenses use invoice due date", () => {
  const s = statement({ dueDate: "2020-01-15" });
  assert.equal(getStatementPayment(s).entryStatus, "previsto");
  const plan = buildStatementImportPlan(s, { one: classified() }, []);
  const result = createLocalStatementEntries(plan, [], []);
  assert.equal(result.createdEntries[0].date, "2020-01-15");
  assert.equal(result.createdEntries[0].purchaseDate, "2026-11-02");
});
test("source identities survive page and file revisions and distinguish cards and repeated purchases", () => {
  const first = identifyStatement(statement());
  const revision = identifyStatement(statement({ fingerprint: "b".repeat(64), transactions: [transaction("different", 10000, { page: 8 })] }));
  assert.equal(first.transactions[0].sourceKey, revision.transactions[0].sourceKey);
  const other = identifyStatement(statement({ cardLast4: "9999", maskedCardNumber: "1234XXXXXXXX9999" }));
  assert.notEqual(first.transactions[0].sourceKey, other.transactions[0].sourceKey);
  const repeats = identifyStatement(statement({ transactions: [transaction(), transaction("two")] }));
  assert.notEqual(repeats.transactions[0].sourceKey, repeats.transactions[1].sourceKey);
});
test("credits offset only new expenses in the same explicit classification and never become income", () => {
  const s = statement({ transactions: [transaction(), transaction("fee", 6650, { kind: "fee" }), transaction("c1", -3325), transaction("c2", -3325)] });
  const d = { one: classified(), fee: classified({ category: "Tarifas e impostos" }), c1: classified({ category: "Tarifas e impostos" }), c2: classified({ category: "Tarifas e impostos" }) };
  const plan = buildStatementImportPlan(s, d, []);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.newEntries.length, 1);
  assert.equal(plan.offsets.length, 3);
  const result = createLocalStatementEntries(plan, [], []);
  assert.equal(result.createdEntries.length, 1);
  assert.equal(result.createdEntries[0].kind, "despesa");
  assert.equal(result.createdEntries[0].amount, 100);
  assert.equal(result.applied.length, 4);
});
test("unclassified credits or credits in a different unit block financial creation", () => {
  const s = statement({ transactions: [transaction(), transaction("credit", -500)], currentTotalCents: 9500, computedCurrentCents: 9500, invoiceTotalCents: 9500 });
  assert.ok(buildStatementImportPlan(s, { one: classified() }, []).blockers.some(b => b.includes("créditos")));
  const plan = buildStatementImportPlan(s, { one: classified(), credit: classified({ nature: "PF", costCenter: "Pessoa Física" }) }, []);
  assert.ok(plan.blockers.some(b => b.includes("sem despesa nova")));
});
test("repeated application does not create expenses twice, including a changed PDF fingerprint", () => {
  const first = createLocalStatementEntries(buildStatementImportPlan(statement(), { one: classified() }, []), [], []);
  const nextPlan = buildStatementImportPlan(statement({ fingerprint: "b".repeat(64) }), { one: classified() }, first.createdEntries, first.applied);
  assert.equal(nextPlan.newEntries.length, 0);
  assert.equal(nextPlan.alreadyApplied.length, 1);
  assert.equal(createLocalStatementEntries(nextPlan, first.createdEntries, first.applied).createdEntries.length, 0);
});
test("unrecognized purchases stay out of creation; matching existing entries need an explicit decision", () => {
  const s = statement({ transactions: [transaction(), transaction("two", 20000)], computedCurrentCents: 30000, currentTotalCents: 30000, invoiceTotalCents: 30000 });
  const plan = buildStatementImportPlan(s, { one: classified(), two: classified({ status: "unrecognized" }) }, []);
  assert.equal(plan.newEntries.length, 1);
  assert.equal(plan.heldCount, 1);
  const existing = [{ id: "existing", date: "2026-11-02", amount: 100, description: "COMPRA EXEMPLO", kind: "despesa", unit: "Consultoria" }];
  assert.ok(buildStatementImportPlan(statement(), { one: classified() }, existing).blockers.some(b => b.includes("nova despesa")));
  assert.equal(buildStatementImportPlan(statement(), { one: classified({ confirmedNew: true }) }, existing).blockers.length, 0);
});
test("import payload contains all items and a source identity for server verification", () => {
  const s = statement();
  const plan = buildStatementImportPlan(s, { one: classified() }, []);
  const payload = importPayload(plan);
  assert.equal(payload.statement.card_key, statementCardKey(s));
  assert.equal(payload.items[0].source_key[0], statementCardKey(s));
  assert.equal(payload.items[0].net_cents, 10000);
  assert.ok(buildStatementImportPlan(s, { one: classified() }, null).blockers.length);
});
test("unrecognized status and notes are preserved in the server payload without a financial amount", () => {
  const s = statement();
  const plan = buildStatementImportPlan(s, { one: classified({ status: "unrecognized", note: "Em apuração" }) }, []);
  const p = importPayload(plan);
  assert.equal(p.items[0].status, "unrecognized");
  assert.equal(p.items[0].note, "Em apuração");
  assert.equal(p.items[0].net_cents, 0);
});
test("changed amounts on the same merchant and purchase date require review", () => {
  const existing = [{ id: "e1", kind: "despesa", description: "COMPRA EXEMPLO", date: "2026-11-02", amount: 101 }];
  assert.ok(buildStatementImportPlan(statement(), { one: classified() }, existing).blockers.some(b => b.includes("nova despesa")));
});
test("a later paid statement can settle only unchanged expenses created by this import", () => {
  const initial = createLocalStatementEntries(buildStatementImportPlan(statement(), { one: classified() }, []), [], []);
  const paid = statement({ fingerprint: "b".repeat(64), invoiceTotalCents: 0, paymentsTotalCents: -10000, transactions: [transaction(), transaction("pay", -10000, { kind: "payment", date: "2026-11-05" })] });
  const plan = buildStatementImportPlan(paid, {}, initial.createdEntries, initial.applied);
  assert.equal(plan.newEntries.length, 0);
  assert.equal(plan.settlements.length, 1);
  const result = createLocalStatementEntries(plan, initial.createdEntries, initial.applied);
  assert.equal(result.createdEntries.length, 0);
  assert.equal(result.existingEntries[0].status, "realizado");
  assert.equal(result.existingEntries[0].paidDate, "2026-11-05");
  const altered = buildStatementImportPlan(paid, {}, initial.createdEntries.map(e => ({ ...e, amount: 101 })), initial.applied);
  assert.equal(altered.settlements.length, 0);
  assert.ok(altered.blockers.some(b => b.includes("alterado")));
});
