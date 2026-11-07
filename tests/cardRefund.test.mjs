import assert from "node:assert/strict";
import test from "node:test";
import { identifyStatement, buildStatementImportPlan, createLocalStatementEntries, importPayload } from "../src/lib/cardImport.ts";
import { refundDecision, reviewIsComplete, reviewIsResolved } from "../src/lib/cardStatement.ts";
import { availableRefundCredits, validateCardRefund } from "../src/lib/cardRefund.ts";

const tx = (id, amountCents, extra = {}) => ({ id, date: "2026-11-02", description: id, amountCents, kind: amountCents < 0 ? "credit" : "purchase", page: 1, sourceLine: "synthetic", detail: "", ...extra });
const statement = (transactions = [tx("purchase", 10000)], extra = {}) => identifyStatement({ fingerprint: "e".repeat(64), fileName: "synthetic.pdf", pageCount: 1, dueDate: "2026-11-15", cardLast4: "5678", bankCode: "itau", maskedCardNumber: "1234XXXXXXXX5678", transactions, currentTotalCents: transactions.reduce((sum, t) => sum + t.amountCents, 0), computedCurrentCents: transactions.reduce((sum, t) => sum + t.amountCents, 0), invoiceTotalCents: transactions.reduce((sum, t) => sum + t.amountCents, 0), previousBalanceCents: 0, paymentsTotalCents: 0, warnings: [], ...extra });
const decision = { status: "classified", nature: "PJ", costCenter: "Consultoria", category: "Software", note: "", confirmedNew: true };
const refund = (s, extra = {}) => ({ sourceKey: s.transactions[0].sourceKey, amountCents: s.transactions[0].amountCents, date: "2026-11-06", note: "Cancelamento confirmado", ...extra });

test("a refunded purchase closes the occurrence without becoming a financial classification", () => {
  const s = statement(), r = refund(s), d = refundDecision(s.transactions[0], [r]);
  assert.equal(d.status, "refunded"); assert.equal(reviewIsComplete(s.transactions[0], d), false);
  assert.equal(reviewIsResolved(s.transactions[0], d), true);
  const plan = buildStatementImportPlan(s, {}, [], [], [r]);
  assert.equal(plan.heldCount, 0); assert.equal(plan.refundedCount, 1); assert.equal(plan.newEntries.length, 0);
  assert.equal(createLocalStatementEntries(plan, [], []).applied.length, 0);
  assert.equal(importPayload(plan).items[0].net_cents, 0);
});
test("a linked refund credit does not offset unrelated spending or change invoice totals", () => {
  const s = statement([tx("purchase", 10000), tx("other", 20000), tx("credit", -10000)]);
  const r = refund(s, { creditSourceKey: s.transactions[2].sourceKey });
  const plan = buildStatementImportPlan(s, { other: decision }, [], [], [r]);
  assert.deepEqual(plan.blockers, []); assert.equal(plan.refundedCount, 2); assert.equal(plan.heldCount, 0);
  const result = createLocalStatementEntries(plan, [], []);
  assert.equal(result.createdEntries.length, 1); assert.equal(result.createdEntries[0].amount, 200);
  assert.equal(plan.statement.computedCurrentCents, 20000);
  assert.equal(refundDecision(s.transactions[2], [r]).status, "refund_credit");
});
test("cross-cycle credit links survive reimported PDF hashes and remain outside new spending", () => {
  const old = statement(), current = statement([tx("other", 20000), tx("credit", -10000)], { dueDate: "2026-12-15", fingerprint: "f".repeat(64) });
  const r = refund(old, { creditSourceKey: current.transactions[1].sourceKey });
  const plan = buildStatementImportPlan(current, { other: decision }, [], [], [r]);
  assert.deepEqual(plan.blockers, []); assert.equal(plan.newEntries[0].netCents, 20000);
  const revision = statement(undefined, { fingerprint: "b".repeat(64) });
  assert.equal(buildStatementImportPlan(revision, {}, [], [], [r]).heldCount, 0);
});
test("refunds require a full exact amount and a real date on or after the purchase", () => {
  const r = refund(statement());
  for (const amountCents of [0, -1, 5000, 10001, 10000.2, NaN]) assert.throws(() => validateCardRefund({ ...r, amountCents }), /integral/);
  for (const date of ["", "2026-02-30", "2026-11-01", "not-a-date"]) assert.throws(() => validateCardRefund({ ...r, date }), /data válida/);
  assert.doesNotThrow(() => validateCardRefund(r));
});
test("a processed purchase, consumed credit or credit assigned elsewhere cannot be reused", () => {
  const s = statement([tx("purchase", 10000), tx("credit", -10000)]), r = refund(s, { creditSourceKey: s.transactions[1].sourceKey });
  assert.throws(() => validateCardRefund(r, [{ sourceKey: r.sourceKey }]), /processada/);
  assert.throws(() => validateCardRefund(r, [{ sourceKey: r.creditSourceKey }]), /processado/);
  assert.throws(() => validateCardRefund(r, [], [{ ...r, sourceKey: "other" }]), /outra compra/);
  assert.throws(() => validateCardRefund({ ...r, creditSourceKey: statement([tx("credit", -10000)], { maskedCardNumber: "1234XXXXXXXX9999", cardLast4: "9999" }).transactions[0].sourceKey }), /mesmo cartão/);
});
test("credit picker excludes other cards, other amounts and consumed credits", () => {
  const s = statement([tx("purchase", 10000), tx("eligible", -10000), tx("consumed", -10000), tx("wrong-amount", -5000)]);
  const other = statement([tx("wrong-card", -10000)], { maskedCardNumber: "1234XXXXXXXX9999", cardLast4: "9999" });
  const options = availableRefundCredits([...s.transactions, ...s.transactions, ...other.transactions], s.transactions[0], [{ sourceKey: s.transactions[2].sourceKey }], []);
  assert.deepEqual(options.map(t => t.id), ["eligible"]);
});
