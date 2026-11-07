import type { CardRefund, StatementTransaction } from "./cardStatement.ts";
import type { AppliedStatementItem } from "./cardImport.ts";

function source(key: string): unknown[] {
  try { const value = JSON.parse(key); if (Array.isArray(value) && value.length === 8) return value; } catch { /* Report an actionable validation error below. */ }
  throw new Error("A origem da movimentação não foi identificada.");
}
export function validateCardRefund(refund: CardRefund, applied: AppliedStatementItem[] = [], refunds: CardRefund[] = []) {
  const purchase = source(refund.sourceKey);
  if (!["purchase", "fee"].includes(String(purchase[2])) || !Number.isSafeInteger(purchase[5]) || Number(purchase[5]) <= 0) throw new Error("Selecione uma compra ou encargo ainda não lançado.");
  if (!Number.isSafeInteger(refund.amountCents) || refund.amountCents !== purchase[5]) throw new Error("Para encerrar a ocorrência, informe o valor integral da compra. Estornos parciais devem permanecer em apuração.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(refund.date) || !Number.isFinite(Date.parse(`${refund.date}T12:00:00Z`)) || new Date(`${refund.date}T12:00:00Z`).toISOString().slice(0, 10) !== refund.date || refund.date < String(purchase[3])) throw new Error("Informe uma data válida de estorno, a partir da data da compra.");
  if (typeof refund.note !== "string" || refund.note.length > 1000) throw new Error("A observação deve ter até 1.000 caracteres.");
  const used = new Set(applied.map(item => item.sourceKey));
  if (used.has(refund.sourceKey)) throw new Error("A compra já foi processada. Corrija o lançamento financeiro antes de registrar o estorno.");
  if (refund.creditSourceKey) {
    const credit = source(refund.creditSourceKey);
    if (credit[0] !== purchase[0] || credit[2] !== "credit" || credit[5] !== -refund.amountCents) throw new Error("O crédito deve pertencer ao mesmo cartão e ter o valor integral do estorno.");
    if (used.has(refund.creditSourceKey)) throw new Error("Este crédito já foi processado e não pode ser usado novamente.");
    if (refunds.some(r => r.sourceKey !== refund.sourceKey && r.creditSourceKey === refund.creditSourceKey)) throw new Error("Este crédito já foi vinculado a outra compra estornada.");
  }
}
export function refundDescription(refund: CardRefund, credit = false): string {
  return `${credit ? "Crédito vinculado ao estorno" : "Estorno integral registrado"}: ${(refund.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${refund.date.split("-").reverse().join("/")}.${refund.creditSourceKey ? " Crédito da fatura vinculado." : " Sem crédito vinculado; cancelamento informado pelo usuário."}${refund.note ? ` ${refund.note}` : ""}`;
}
export function availableRefundCredits(transactions: StatementTransaction[], purchase: StatementTransaction, applied: AppliedStatementItem[], refunds: CardRefund[]) {
  const card = purchase.sourceKey ? source(purchase.sourceKey)[0] : undefined;
  return [...new Map(transactions.filter(t => t.sourceKey && t.kind === "credit" && t.amountCents === -purchase.amountCents && source(t.sourceKey)[0] === card && !applied.some(a => a.sourceKey === t.sourceKey) && !refunds.some(r => r.sourceKey !== purchase.sourceKey && r.creditSourceKey === t.sourceKey)).map(t => [t.sourceKey!, t])).values()];
}
