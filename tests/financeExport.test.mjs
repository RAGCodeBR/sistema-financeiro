import assert from "node:assert/strict";
import test from "node:test";
import { categoriesForExport, exportPeriodRange, filterFinanceEntries, summarizeEntries } from "../src/lib/financeExport.ts";

const entries = [
  { id: "a", date: "2026-10-01", kind: "receita", status: "realizado", unit: "Consultoria", account: "Consultoria", category: "Honorários", description: "Projeto", amount: 2000 },
  { id: "b", date: "2026-10-02", kind: "receita", status: "previsto", unit: "Consultoria", account: "Consultoria", category: "Honorários", description: "Contrato", amount: 300 },
  { id: "c", date: "2026-10-03", kind: "despesa", status: "realizado", unit: "Consultoria", account: "Consultoria", category: "Serviços", description: "Fornecedor", amount: 500, juros: 20, discount: 5 },
  { id: "d", date: "2026-10-04", kind: "despesa", status: "previsto", unit: "Sítio", account: "Sítio", category: "Serviços", description: "Outro fornecedor", amount: 100 },
];

test("summary reconciles realized and pending values with interest and discount", () => {
  assert.deepEqual(summarizeEntries(entries), {
    receitas: 2300,
    despesas: 615,
    recebido: 2000,
    aReceber: 300,
    pago: 515,
    aPagar: 100,
  });
});

test("category rows stay separate by kind and cost center", () => {
  assert.deepEqual(categoriesForExport(entries), [
    { kind: "receita", unit: "Consultoria", category: "Honorários", count: 2, realized: 2000, pending: 300, total: 2300 },
    { kind: "despesa", unit: "Consultoria", category: "Serviços", count: 1, realized: 515, pending: 0, total: 515 },
    { kind: "despesa", unit: "Sítio", category: "Serviços", count: 1, realized: 0, pending: 100, total: 100 },
  ]);
});

test("export filters combine dates, type, status, center, category and search", () => {
  assert.deepEqual(
    filterFinanceEntries(entries, {
      from: "2026-10-01", to: "2026-10-03", kind: "despesa",
      status: "realizado", unit: "Consultoria", category: "Serviços",
      search: "fornecedor",
    }).map((entry) => entry.id),
    ["c"],
  );
  assert.deepEqual(filterFinanceEntries(entries, { to: "2026-10-02", kind: "receita" }).map((entry) => entry.id), ["a", "b"]);
});

test("ready-made export views distinguish payable, receivable, paid and received", () => {
  const expected = {
    despesas: ["c", "d"], receitas: ["a", "b"],
    "a-pagar": ["d"], "a-receber": ["b"], pagas: ["c"], recebidas: ["a"],
    atrasadas: ["b", "d"],
    "atrasadas-pagar": ["d"], "atrasadas-receber": ["b"],
  };
  for (const [view, ids] of Object.entries(expected)) {
    assert.deepEqual(filterFinanceEntries(entries, { view, today: "2026-10-05" }).map((entry) => entry.id), ids, view);
  }
  assert.deepEqual(filterFinanceEntries(entries, { view: "atrasadas-pagar", today: "2026-10-04" }), []);
  assert.deepEqual(filterFinanceEntries(entries, { view: "a-pagar", unit: "Consultoria" }), []);
});

test("period shortcuts cover complete calendar intervals", () => {
  const today = new Date(2026, 9, 21);
  assert.deepEqual(exportPeriodRange("hoje", "", "", today), { from: "2026-10-21", to: "2026-10-21" });
  assert.deepEqual(exportPeriodRange("semana", "", "", today), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(exportPeriodRange("mes", "", "", today), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(exportPeriodRange("mes-anterior", "", "", today), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(exportPeriodRange("ano", "", "", today), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(exportPeriodRange("personalizado", "2025-01-01", "2025-01-31", today), { from: "2025-01-01", to: "2025-01-31" });
});

test("advanced filters combine effective payment date, amount and optional fields", () => {
  const transactions = [
    { ...entries[2], paidDate: "2026-10-09", pix: "abc", notes: "contrato", attachments: ["file"], juros: 20, discount: 5 },
    { ...entries[2], id: "other", paidDate: "2026-10-12", amount: 300, juros: 0, discount: 0, pix: "", notes: "", attachments: [] },
    { ...entries[2], id: "undated", paidDate: undefined, amount: 300, juros: 0, discount: 0 },
  ];
  assert.deepEqual(filterFinanceEntries(transactions, {
    dateField: "liquidacao", from: "2026-10-08", to: "2026-10-10",
    minAmount: 500, maxAmount: 520, pix: "com", notes: "com",
    attachments: "com", paymentAdjustment: "juros",
  }).map((entry) => entry.id), ["c"]);
  assert.deepEqual(filterFinanceEntries(transactions, { dateField: "liquidacao", from: "2026-10-10" }).map((entry) => entry.id), ["other"]);
  assert.deepEqual(filterFinanceEntries(transactions, { pix: "sem", notes: "sem", attachments: "sem" }).map((entry) => entry.id), ["other", "undated"]);
});

test("recurrence, installments and single entries have exclusive export views", () => {
  const transactions = [
    { ...entries[3], id: "monthly", recurrence: "mensal", installment: "2/3" },
    { ...entries[3], id: "installment", recurrence: "nenhuma", installment: "2/3" },
    { ...entries[3], id: "single", recurrence: "nenhuma" },
  ];
  assert.deepEqual(filterFinanceEntries(transactions, { view: "recorrentes" }).map((entry) => entry.id), ["monthly"]);
  assert.deepEqual(filterFinanceEntries(transactions, { view: "parcelados" }).map((entry) => entry.id), ["installment"]);
  assert.deepEqual(filterFinanceEntries(transactions, { view: "unicos" }).map((entry) => entry.id), ["single"]);
});
