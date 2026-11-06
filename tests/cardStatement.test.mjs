import assert from "node:assert/strict";
import test from "node:test";
import { brlCents, currentTransactions, emptyDecision, parseItauStatement, reconcileStatement, reviewIsComplete } from "../src/lib/cardStatement.ts";

const token = (text, x, y) => ({ text, x, y });
const heading = [token("Vencimento: 15/01/2026", 40, 800), token("Cartão 1234.XXXX.XXXX.5678", 40, 780)];
const purchase = (id = "t1", overrides = {}) => ({ id, date: "2026-01-02", description: "LOJA EXEMPLO", amountCents: 12345, kind: "purchase", page: 2, detail: "", sourceLine: "02/01 LOJA EXEMPLO 123,45", ...overrides });
const entry = (id = "e1", overrides = {}) => ({ id, date: "2026-01-02", description: "LOJA EXEMPLO", amount: 123.45, kind: "despesa", unit: "Consultoria", ...overrides });

test("Brazilian currency is exact in centavos, including credits", () => {
  assert.equal(brlCents("6.649,77"), 664977);
  assert.equal(brlCents("- 33,25"), -3325);
  assert.equal(brlCents("0,00"), 0);
  assert.throws(() => brlCents("12.34"));
});

test("asymmetric two-column Itaú tables retain whole merchants and BRL international values", () => {
  const statement = parseItauStatement([{ page: 1, tokens: [...heading,
    token("Total da fatura anterior", 365, 750), token("0,00", 542, 750),
    token("Pagamentos efetuados", 365, 735), token("-134,45", 528, 735),
    token("Lançamentos atuais", 365, 720), token("134,45", 530, 720),
    token("Total desta fatura", 365, 705), token("0,00", 542, 705),
  ] }, { page: 2, tokens: [
    token("Lançamentos: compras e saques", 133, 700),
    token("02/01", 133, 680), token("LOJA EXEMPLO CONTINUA", 161, 680), token("123,45", 310, 680),
    token("supermercado CIDADE", 161, 670),
    token("Lançamentos internacionais", 351, 700),
    token("30/12 SOFTWARE EXTERIOR 01/03", 351, 680), token("10,00", 534, 680),
    token("1,80", 497, 670), token("Dólar de Conversão R$ 5,55", 371, 660),
    token("Repasse de IOF em R$", 351, 645), token("1,00", 534, 645),
    token("Pagamentos efetuados", 133, 630),
    token("05/01", 133, 610), token("PAGAMENTO PIX", 161, 610), token("-134,45", 305, 610),
  ] }, { page: 3, tokens: [
    token("Compras parceladas - próximas faturas", 143, 700),
    token("30/12", 143, 680), token("SOFTWARE EXTERIOR 02/03", 170, 680), token("10,00", 315, 680),
  ] }]);
  assert.equal(statement.dueDate, "2026-01-15");
  assert.equal(statement.cardLast4, "5678");
  assert.equal(statement.invoiceTotalCents, 0);
  assert.equal(statement.paymentsTotalCents, -13445);
  assert.equal(statement.computedCurrentCents, 13445);
  assert.equal(statement.transactions.length, 5);
  assert.equal(statement.transactions[0].description, "LOJA EXEMPLO CONTINUA");
  const international = statement.transactions.find(t => t.kind === "purchase" && t.installment === "01/03");
  assert.equal(international.date, "2025-12-30");
  assert.equal(international.amountCents, 1000);
  assert.equal(international.installment, "01/03");
  assert.equal(currentTransactions(statement).length, 3);
  assert.deepEqual(statement.warnings, []);
});

test("mismatched totals are warnings, never a silently successful read", () => {
  const s = parseItauStatement([{ page: 1, tokens: [...heading,
    token("Lançamentos atuais", 40, 740), token("999,99", 240, 740),
    token("Lançamentos: compras e saques", 40, 700),
    token("02/01 LOJA EXEMPLO 123,45", 40, 680),
    token("03/01 LINHA QUEBRADA", 40, 660),
  ] }]);
  assert.ok(s.warnings.some(w => w.includes("difere")));
  assert.ok(s.warnings.some(w => w.includes("não pôde ser lida")));
});

test("credits reduce current spending while payments and future installments are excluded", () => {
  const s = parseItauStatement([{ page: 1, tokens: [...heading,
    token("Lançamentos atuais", 40, 750), token("10,00", 240, 750),
    token("Lançamentos: produtos e serviços", 40, 700),
    token("02/01 MENSALIDADE 20,00", 40, 680),
    token("03/01 REDUÇÃO MENSALIDADE -10,00", 40, 660),
    token("Limites de crédito", 40, 630), token("04/01 NÃO É UMA COMPRA 900,00", 40, 610),
  ] }]);
  assert.equal(s.computedCurrentCents, 1000);
  assert.deepEqual(s.transactions.map(t => t.kind), ["fee", "credit"]);
});

test("repeated purchases remain separate rows, even with identical date and value", () => {
  const s = parseItauStatement([{ page: 1, tokens: [...heading, token("Lançamentos: compras e saques", 40, 700), token("02/01 LOJA 10,00", 40, 680), token("02/01 LOJA 10,00", 40, 660)] }]);
  assert.equal(s.transactions.length, 2);
  assert.notEqual(s.transactions[0].id, s.transactions[1].id);
});

test("no comparison base is different from a loaded base without matches", () => {
  assert.equal(reconcileStatement([purchase()], null).t1.status, "uncompared");
  assert.equal(reconcileStatement([purchase()], []).t1.status, "new");
});

test("same amount without matching merchant only suggests a possible match", () => {
  const result = reconcileStatement([purchase()], [entry("e1", { description: "OUTRO ESTABELECIMENTO" })]);
  assert.equal(result.t1.status, "possible");
});

test("one existing entry cannot automatically cover repeated purchases", () => {
  const result = reconcileStatement([purchase("t1"), purchase("t2")], [entry()]);
  assert.equal(result.t1.status, "ambiguous");
  assert.equal(result.t2.status, "ambiguous");
});

test("multiple candidates require review, and different cards or installments do not match", () => {
  assert.equal(reconcileStatement([purchase()], [entry("e1"), entry("e2")]).t1.status, "ambiguous");
  assert.equal(reconcileStatement([purchase("t1", { cardLast4: "1111" })], [entry("e1", { cardLast4: "2222" })]).t1.status, "new");
  assert.equal(reconcileStatement([purchase("t1", { installment: "01/03" })], [entry("e1", { installment: "2/3" })]).t1.status, "new");
  assert.equal(reconcileStatement([purchase("t1", { installment: "01/03" })], [entry("e1", { installment: "1/3" })]).t1.status, "matched");
});

test("nearby due dates can suggest a purchase while older repeated installments are not auto matched", () => {
  assert.equal(reconcileStatement([purchase()], [entry("e1", { date: "2026-01-15" })]).t1.status, "possible");
  assert.equal(reconcileStatement([purchase()], [entry("e1", { date: "2025-10-01" })]).t1.status, "new");
  assert.equal(reconcileStatement([purchase()], [entry("e1", { kind: "receita" })]).t1.status, "new");
});

test("a classification requires nature, center and category; unrecognized is unresolved", () => {
  const decision = { ...emptyDecision(), status: "classified", nature: "PJ", costCenter: "Consultoria", category: "Software" };
  assert.equal(reviewIsComplete(purchase(), decision), true);
  assert.equal(reviewIsComplete(purchase(), { ...decision, category: "" }), false);
  assert.equal(reviewIsComplete(purchase(), { ...decision, status: "unrecognized" }), false);
  assert.equal(reviewIsComplete(purchase(), { ...emptyDecision(), status: "linked", linkedEntryId: "e1" }), true);
});

test("unsupported or image-only PDFs produce an actionable error", () => {
  assert.throws(() => parseItauStatement([{ page: 1, tokens: [] }]), /vencimento/);
  assert.throws(() => parseItauStatement([{ page: 1, tokens: heading }]), /Nenhuma movimentação/);
});
