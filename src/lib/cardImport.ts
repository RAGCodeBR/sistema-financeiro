import { currentTransactions, reconcileStatement, refundDecision, reviewIsComplete, type CardRefund, type CardStatement, type ComparisonEntry, type ReviewDecision, type StatementTransaction } from "./cardStatement.ts";
import { validateCardRefund } from "./cardRefund.ts";

export type StatementPayment = { state: "paid" | "open" | "unknown"; entryStatus: "previsto" | "realizado"; paidDate: string; explanation: string };
export type AppliedStatementItem = { sourceKey: string; entryId: string | null; nature: "PF" | "PJ"; costCenter: string; category: string; netCents: number; status: "created" | "linked" | "offset"; cardKey: string; dueDate: string; note?: string };
export type StatementReviewState = { applied: AppliedStatementItem[]; drafts: Record<string, ReviewDecision>; refunds?: CardRefund[]; refundsReady?: boolean };
export type StatementImportEntry = ComparisonEntry & {
  kind: "despesa"; unit: string; account: string; category: string; beneficiary: string; pix: string;
  status: "previsto" | "realizado"; recurrence: "nenhuma" | "mensal"; installments: number; notes: string;
  nature: "PF" | "PJ"; cardLast4: string; cardKey: string; cardSourceKey: string; purchaseDate: string;
};
export type ImportPlanItem = { transaction: StatementTransaction; decision: ReviewDecision; netCents: number; creditCents: number; sourceKey: string };
export type StatementImportPlan = { statement: CardStatement; decisions: Record<string, ReviewDecision>; payment: StatementPayment; items: ImportPlanItem[]; newEntries: ImportPlanItem[]; links: ImportPlanItem[]; offsets: ImportPlanItem[]; alreadyApplied: AppliedStatementItem[]; settlements: ComparisonEntry[]; heldCount: number; refundedCount: number; blockers: string[] };
export type ConfirmStatementPayload = ReturnType<typeof importPayload>;
export type ConfirmStatementResult = { createdEntries: StatementImportEntry[]; existingEntries?: StatementImportEntry[]; applied: AppliedStatementItem[]; alreadyAppliedCount: number; settledCount?: number };
export const statementCardKey = (s: CardStatement) => `${s.bankCode || "itau"}:${s.maskedCardNumber || s.cardLast4}`;
export const sourceKeyString = (value: unknown) => typeof value === "string" ? JSON.stringify(JSON.parse(value)) : JSON.stringify(value);
const merchantKey = (text: string) => text.trim().replace(/\s+/g, " ").toUpperCase();

export function identifyStatement(s: CardStatement): CardStatement {
  const seen = new Map<string, number>(), cardKey = statementCardKey(s);
  return { ...s, transactions: s.transactions.map(t => {
    const base = [cardKey, s.dueDate, t.kind, t.date, merchantKey(t.description), t.amountCents, t.installment || ""];
    const key = JSON.stringify(base), occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    return { ...t, sourceKey: JSON.stringify([...base, occurrence]) };
  }) };
}
export function getStatementPayment(s: CardStatement): StatementPayment {
  const payments = s.transactions.filter(t => t.kind === "payment" && t.amountCents < 0);
  const paymentSum = payments.reduce((sum, t) => sum + t.amountCents, 0);
  const balanced = !s.warnings.length && s.currentTotalCents === s.computedCurrentCents && s.previousBalanceCents !== null && s.paymentsTotalCents !== null && s.invoiceTotalCents !== null && s.previousBalanceCents + s.paymentsTotalCents + s.computedCurrentCents === s.invoiceTotalCents;
  if (balanced && s.invoiceTotalCents === 0 && s.computedCurrentCents > 0 && s.previousBalanceCents! + s.computedCurrentCents > 0 && paymentSum === s.paymentsTotalCents && -paymentSum >= s.previousBalanceCents! + s.computedCurrentCents && payments.length) {
    return { state: "paid", entryStatus: "realizado", paidDate: payments.map(t => t.date).sort().at(-1)!, explanation: "Pagamento identificado: saldo anterior, pagamentos detalhados e movimentações fecham com total a pagar de R$ 0,00." };
  }
  if (s.invoiceTotalCents !== null && s.invoiceTotalCents > 0) return { state: "open", entryStatus: "previsto", paidDate: "", explanation: "A fatura apresenta valor a pagar. As despesas serão criadas como previstas, no vencimento identificado; o PDF não confirma um pagamento posterior à sua emissão." };
  return { state: "unknown", entryStatus: "previsto", paidDate: "", explanation: "O documento não comprova a quitação integral. As despesas permanecem previstas; nenhum pagamento será presumido pela data de vencimento." };
}

export function buildStatementImportPlan(statement: CardStatement, decisions: Record<string, ReviewDecision>, entries: ComparisonEntry[] | null, applied: AppliedStatementItem[] = [], refunds: CardRefund[] = []): StatementImportPlan {
  const s = identifyStatement(statement), current = currentTransactions(s), payment = getStatementPayment(s);
  const appliedByKey = new Map(applied.map(a => [a.sourceKey, a]));
  const alreadyApplied = current.flatMap(t => appliedByKey.has(t.sourceKey!) ? [appliedByKey.get(t.sourceKey!)!] : []);
  const matches = reconcileStatement(current, entries), blockers = [...s.warnings];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.dueDate) || !/^\d{4}$/.test(s.cardLast4)) blockers.push("Vencimento ou cartão não identificados no PDF.");
  if (!s.fingerprint || entries === null) blockers.push("Carregue a base de lançamentos antes de confirmar a criação.");
  if (alreadyApplied.some(item => item.status !== "offset" && !item.entryId)) blockers.push("Um lançamento desta fatura foi removido. Revise o histórico antes de reimportar.");
  const settlements: ComparisonEntry[] = [];
  if (payment.state === "paid") for (const item of alreadyApplied.filter(item => item.status === "created")) {
    const entry = entries?.find(e => e.id === item.entryId);
    if (entry?.status !== "previsto") continue;
    if (Math.round(entry.amount * 100) !== item.netCents || entry.unit !== item.costCenter || entry.category !== item.category) blockers.push(`O lançamento ${entry.description} foi alterado. Revise a baixa antes de confirmar o pagamento da fatura.`);
    else settlements.push(entry);
  }
  const items: ImportPlanItem[] = [];
  let refundedCount = 0;
  const linkedIds = new Set<string>();
  for (const t of current) {
    if (appliedByKey.has(t.sourceKey!)) continue;
    const resolution = refundDecision(t, refunds);
    if (resolution) {
      try { validateCardRefund(resolution.refund!, applied, refunds); refundedCount++; }
      catch (e) { blockers.push(e instanceof Error ? e.message : "Revise os dados do estorno."); }
      continue;
    }
    const d = decisions[t.id];
    if (!reviewIsComplete(t, d)) {
      if (t.amountCents < 0) blockers.push("Classifique os créditos e ajustes antes de gerar despesas, para que os abatimentos sejam considerados.");
      continue;
    }
    if (d.status === "linked") {
      if (!entries?.some(e => e.id === d.linkedEntryId)) blockers.push(`O lançamento vinculado a ${t.description} não está disponível na base atual.`);
      if (linkedIds.has(d.linkedEntryId!)) blockers.push("Duas compras não podem usar o mesmo lançamento existente.");
      linkedIds.add(d.linkedEntryId!);
    } else if (matches[t.id]?.matches.length && !d.confirmedNew) blockers.push(`Confirme se ${t.description} é uma nova despesa ou vincule ao lançamento sugerido.`);
    items.push({ transaction: t, decision: d, netCents: Math.max(0, t.amountCents), creditCents: 0, sourceKey: t.sourceKey! });
  }
  const groups = new Map<string, ImportPlanItem[]>();
  for (const item of items.filter(i => i.decision.status === "classified")) {
    const d = item.decision, key = JSON.stringify([d.nature, d.costCenter, d.category]);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  for (const group of groups.values()) {
    const credit = -group.filter(i => i.transaction.amountCents < 0).reduce((sum, i) => sum + i.transaction.amountCents, 0);
    let remaining = credit;
    // Credits only offset newly created expenses in the explicitly selected
    // nature/center/category. Never modify a linked existing entry implicitly.
    const positive = group.filter(i => i.transaction.amountCents > 0).sort((a, b) => Number(b.transaction.kind === "fee") - Number(a.transaction.kind === "fee"));
    for (const item of positive) { const offset = Math.min(item.netCents, remaining); item.creditCents = offset; item.netCents -= offset; remaining -= offset; }
    if (remaining > 0) blockers.push(`Há créditos sem despesa nova suficiente em ${group[0].decision.costCenter} / ${group[0].decision.category}. Revise a distribuição dos ajustes.`);
  }
  return { statement: s, decisions, payment, items, newEntries: items.filter(i => i.decision.status === "classified" && i.netCents > 0), links: items.filter(i => i.decision.status === "linked"), offsets: items.filter(i => i.decision.status === "classified" && i.netCents === 0), alreadyApplied, settlements, heldCount: current.length - items.length - alreadyApplied.length - refundedCount, refundedCount, blockers: [...new Set(blockers)] };
}

export function importPayload(plan: StatementImportPlan) {
  const s = plan.statement;
  return {
    statement: { fingerprint: s.fingerprint, bank_code: s.bankCode || "itau", card_key: statementCardKey(s), card_last4: s.cardLast4, due_date: s.dueDate,
      current_total_cents: s.currentTotalCents, invoice_total_cents: s.invoiceTotalCents, previous_balance_cents: s.previousBalanceCents, payments_total_cents: s.paymentsTotalCents,
      payment_items: s.transactions.filter(t => t.kind === "payment").map(t => ({ date: t.date, amount_cents: t.amountCents })), warnings: s.warnings },
    items: currentTransactions(s).map(t => {
      const item = plan.items.find(i => i.sourceKey === t.sourceKey);
      const decision = item?.decision || (plan.decisions[t.id]?.status === "unrecognized" ? plan.decisions[t.id] : undefined);
      return { source_key: JSON.parse(t.sourceKey!), date: t.date, description: t.description, amount_cents: t.amountCents, kind: t.kind, installment: t.installment || "", detail: t.detail,
        status: decision?.status || "pending", nature: decision?.nature || "", unit: decision?.costCenter || "", category: decision?.category || "", note: decision?.note || "",
        linked_entry_id: decision?.linkedEntryId || null, net_cents: item?.netCents || 0, confirmed_new: decision?.confirmedNew || false };
    }),
  };
}
export function createLocalStatementEntries(plan: StatementImportPlan, existing: StatementImportEntry[], previousApplied: AppliedStatementItem[]): ConfirmStatementResult {
  if (plan.blockers.length) throw new Error(plan.blockers[0]);
  const already = new Set(previousApplied.map(i => i.sourceKey));
  const createdEntries: StatementImportEntry[] = [], applied: AppliedStatementItem[] = [];
  for (const i of plan.items) {
    if (already.has(i.sourceKey)) continue;
    const { transaction: t, decision: d } = i;
    let entryId: string | null = d.linkedEntryId || null;
    const prior = existing.find(e => e.cardSourceKey === i.sourceKey);
    if (prior) entryId = prior.id;
    else if (d.status === "classified" && i.netCents > 0) {
      entryId = crypto.randomUUID();
      createdEntries.push({ id: entryId, kind: "despesa", description: t.description, beneficiary: t.description, pix: "", amount: i.netCents / 100,
        unit: d.costCenter, account: d.costCenter, category: d.category, date: plan.statement.dueDate, paidDate: plan.payment.paidDate,
        status: plan.payment.entryStatus, recurrence: "nenhuma", installments: Number(t.installment?.split("/")[1] || 1), installment: t.installment,
        notes: [d.note, `Cartão ${plan.statement.cardLast4} | compra ${t.date}`, i.creditCents ? `Créditos abatidos: ${(i.creditCents / 100).toFixed(2)}` : ""].filter(Boolean).join("\n"),
        nature: d.nature as "PJ" | "PF", cardLast4: plan.statement.cardLast4, cardKey: statementCardKey(plan.statement), cardSourceKey: i.sourceKey, purchaseDate: t.date });
    }
    applied.push({ sourceKey: i.sourceKey, entryId, nature: d.nature as "PJ" | "PF", costCenter: d.costCenter, category: d.category, netCents: i.netCents,
      status: d.status === "linked" ? "linked" : i.netCents > 0 ? "created" : "offset", cardKey: statementCardKey(plan.statement), dueDate: plan.statement.dueDate, note: d.note });
  }
  return { createdEntries, applied, existingEntries: existing.filter(e => plan.settlements.some(s => s.id === e.id)).map(e => ({ ...e, status: "realizado", paidDate: plan.payment.paidDate })), alreadyAppliedCount: plan.alreadyApplied.length, settledCount: plan.settlements.length };
}
