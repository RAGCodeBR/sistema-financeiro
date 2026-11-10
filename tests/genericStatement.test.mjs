import assert from "node:assert/strict";
import test from "node:test";
import { genericStatement, statementDate, validateAssistedStatement } from "../src/lib/genericStatement.ts";
import { statementBankLabel, statementCardLabel } from "../src/lib/cardBanks.ts";
import { buildStatementImportPlan, identifyStatement } from "../src/lib/cardImport.ts";
import { validateStatementBatch } from "../src/lib/statementFiles.ts";

const page = (...lines) => [{ page: 1, tokens: lines.map((text, index) => ({ text, x: 20, y: 800 - index * 20 })) }];
const document = () => genericStatement(page("Bradesco", "Cartão final 7788", "Vencimento: 15/12/2026", "Total das compras 150,00", "Total da fatura 150,00", "Saldo anterior 0,00", "Pagamentos efetuados 0,00", "Lançamentos atuais", "02/11 LOJA ALFA 100,00", "03/11 LOJA BETA 50,00"), "example.pdf", "e".repeat(64));
const confirmed = () => ({ ...document(), reviewedExtraction: true, currentTotalCents: 15000 });

test("unknown templates extract candidate rows and bank metadata without claiming validated support", () => {
  const result = document();
  assert.equal(result.bankCode, "bradesco"); assert.equal(result.cardLast4, "7788"); assert.equal(result.dueDate, "2026-12-15");
  assert.equal(result.readingMethod, "assisted"); assert.equal(result.reviewedExtraction, false);
  assert.equal(result.transactions.length, 2); assert.equal(result.computedCurrentCents, 15000);
  assert.equal(result.invoiceTotalCents, 15000);
  assert.equal(statementBankLabel(result), "Bradesco"); assert.equal(statementCardLabel({ ...result, cardLabel: "Cartão da empresa" }), "Cartão da empresa · final 7788");
});
test("assisted reading never treats the extracted sum as an independent invoice total", () => {
  const raw = genericStatement(page("Banco novo", "02/11 LOJA ALFA 100,00"), "example.png", "f".repeat(64));
  assert.equal(raw.currentTotalCents, null); assert.equal(raw.bankCode, ""); assert.equal(raw.dueDate, "");
  assert.equal(raw.transactions[0].date, "02/11");
  assert.throws(() => validateAssistedStatement({ ...confirmed(), currentTotalCents: null }), /soma dos itens/);
  assert.throws(() => validateAssistedStatement({ ...confirmed(), currentTotalCents: 14999 }), /soma dos itens/);
});
test("human verification, identification and real dates are required before activating a generic statement", () => {
  assert.throws(() => validateAssistedStatement(document()), /Confirme que conferiu/);
  assert.throws(() => validateAssistedStatement({ ...confirmed(), bankCode: "" }), /banco/);
  assert.throws(() => validateAssistedStatement({ ...confirmed(), bankCode: "outro", bankName: "" }), /nome do banco/);
  assert.throws(() => validateAssistedStatement({ ...confirmed(), cardLast4: "123" }), /quatro/);
  assert.throws(() => validateAssistedStatement({ ...confirmed(), dueDate: "2026-02-30" }), /data/);
  assert.throws(() => validateAssistedStatement({ ...confirmed(), maskedCardNumber: "1234567890127788" }), /mascarada/);
  const value = validateAssistedStatement(confirmed());
  assert.deepEqual(value.warnings, []); assert.equal(value.transactions[0].date, "2026-11-02");
});
test("payments, future installments and signed credits stay separate in generic reading", () => {
  const raw = genericStatement(page("Nubank", "Cartão final 7788", "Vencimento: 15/01/2027", "Lançamentos atuais", "20/12 COMPRA 01/03 100,00", "21/12 ESTORNO -10,00", "22/12 PAGAMENTO PIX 50,00", "Parcelas futuras", "20/12 COMPRA 02/03 100,00"), "synthetic.pdf", "a".repeat(64));
  assert.deepEqual(raw.transactions.map(t => t.kind), ["purchase", "credit", "payment", "future"]);
  assert.equal(raw.transactions[0].installment, "01/03"); assert.equal(raw.transactions[0].date, "2026-12-20");
  assert.equal(raw.transactions[2].amountCents, -5000); assert.equal(raw.computedCurrentCents, 9000);
  assert.equal(raw.readingMethod, "assisted");
  const value = validateAssistedStatement({ ...raw, currentTotalCents: 9000, reviewedExtraction: true });
  assert.equal(value.transactions.length, 4);
});
test("generic summaries must reconcile and a paid status is not inferred from missing evidence", () => {
  assert.throws(() => validateAssistedStatement({ ...confirmed(), invoiceTotalCents: 16000 }), /Saldo anterior/);
  const value = validateAssistedStatement({ ...confirmed(), invoiceTotalCents: 0, previousBalanceCents: null, paymentsTotalCents: null });
  assert.equal(buildStatementImportPlan(value, {}, []).payment.state, "unknown");
});
test("generic source identity is bank-specific and repeated rows remain distinct", () => {
  const s = validateAssistedStatement(confirmed());
  const first = identifyStatement(s), secondBank = identifyStatement({ ...s, bankCode: "nubank" });
  assert.notEqual(first.transactions[0].sourceKey, secondBank.transactions[0].sourceKey);
  const repeated = identifyStatement({ ...s, transactions: [s.transactions[0], s.transactions[0]] });
  assert.notEqual(repeated.transactions[0].sourceKey, repeated.transactions[1].sourceKey);
});
test("year inference uses invoice context and invalid calendar dates are rejected", () => {
  assert.equal(statementDate("31/12", "2027-01-15"), "2026-12-31"); assert.equal(statementDate("03/11/26"), "2026-11-03");
  assert.throws(() => statementDate("03/11"), /ano/); assert.throws(() => statementDate("31/02/2026"), /data/);
});
test("batch limits bound local reading without silently dropping extra files", () => {
  assert.doesNotThrow(() => validateStatementBatch([{ name: "one.pdf", size: 100 }]));
  assert.throws(() => validateStatementBatch([]), /Selecione/);
  assert.throws(() => validateStatementBatch(Array.from({ length: 11 }, () => ({ name: "test.pdf", size: 100 }))), /10 arquivos/);
  assert.throws(() => validateStatementBatch([{ name: "huge.pdf", size: 101 * 1024 * 1024 }]), /100 MB/);
});
