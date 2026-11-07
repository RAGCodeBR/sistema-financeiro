import { supabase, readAuthenticatedRows } from "./supabase";
import { sourceKeyString, type AppliedStatementItem, type ConfirmStatementPayload, type ConfirmStatementResult, type StatementImportEntry, type StatementReviewState } from "./cardImport";
import type { CardRefund } from "./cardStatement";

const refundFromRow = (row: any): CardRefund => ({ sourceKey: sourceKeyString(row.source_key), amountCents: Number(row.amount_cents), date: row.refund_date, note: row.note || "", creditSourceKey: row.credit_source_key ? sourceKeyString(row.credit_source_key) : undefined });
export async function saveRemoteCardRefund(refund: CardRefund): Promise<CardRefund> {
  const { data, error } = await supabase.rpc("record_card_refund", { payload: { source_key: JSON.parse(refund.sourceKey), amount_cents: refund.amountCents, refund_date: refund.date, note: refund.note, credit_source_key: refund.creditSourceKey ? JSON.parse(refund.creditSourceKey) : null } });
  if (error) {
    if (["PGRST202", "42P01", "42883"].includes(error.code)) throw new Error("O registro de estornos ainda não foi habilitado no banco deste ambiente.");
    throw new Error(error.message || "Não foi possível registrar o estorno. A compra permanece em apuração.");
  }
  return refundFromRow(data);
}

export function importedEntryFromRow(row: any): StatementImportEntry {
  return { ...row, amount: Number(row.amount), kind: "despesa", pix: row.pix || "", beneficiary: row.beneficiary || "", recurrence: row.recurrence === "mensal" ? "mensal" : "nenhuma",
    seriesId: row.series_id || undefined, counterpartyId: row.counterparty_id ?? undefined, juros: row.juros != null ? Number(row.juros) : 0,
    discount: row.discount != null ? Number(row.discount) : undefined, bankId: row.bank_id === undefined ? undefined : row.bank_id,
    paidDate: row.paid_date || "", nature: row.expense_nature, purchaseDate: row.purchase_date, cardLast4: row.card_last4, cardKey: row.card_key,
    cardSourceKey: row.card_source_key ? sourceKeyString(row.card_source_key) : undefined, notes: row.notes || "", installments: row.installments || 1 };
}
const appliedFromRow = (row: any): AppliedStatementItem => ({ sourceKey: sourceKeyString(row.source_key), entryId: row.entry_id, nature: row.nature,
  costCenter: row.unit, category: row.category, netCents: Number(row.net_cents), status: row.status, cardKey: row.card_key, dueDate: row.due_date, note: row.note });
export async function loadRemoteCardItems(cardKey: string, _dueDate: string): Promise<StatementReviewState> {
  try {
    const [rows, refundResult] = await Promise.all([readAuthenticatedRows<any>("card_import_items"), readAuthenticatedRows<any>("card_refund_reviews").then(rows => ({ rows, ready: true })).catch(() => ({ rows: [] as any[], ready: false }))]);
    const cardRows = rows.filter(row => row.card_key === cardKey);
    return { applied: cardRows.filter(row => ["created", "linked", "offset"].includes(row.status)).map(appliedFromRow), refunds: refundResult.rows.filter(row => row.card_key === cardKey).map(refundFromRow), refundsReady: refundResult.ready,
      drafts: Object.fromEntries(cardRows.filter(row => ["pending", "unrecognized"].includes(row.status)).map(row => [sourceKeyString(row.source_key), { status: row.status, nature: row.nature || "", costCenter: row.unit || "", category: row.category || "", note: row.note || "" }])) };
  } catch { throw new Error("A integração de faturas ainda não foi habilitada no banco deste ambiente. A conferência e os relatórios continuam disponíveis."); }
}
export async function confirmRemoteCardStatement(payload: ConfirmStatementPayload): Promise<ConfirmStatementResult> {
  const { data: session, error: sessionError } = await supabase.auth.refreshSession();
  if (sessionError || !session.session) throw new Error("Sua sessão expirou. Entre novamente antes de criar os lançamentos.");
  const { data, error } = await supabase.rpc("confirm_card_statement", { payload });
  if (error) {
    if (["PGRST202", "42P01", "42883"].includes(error.code)) throw new Error("A integração de faturas ainda não foi habilitada no banco deste ambiente.");
    throw new Error(error.message || "Não foi possível confirmar a fatura. Nenhum lançamento parcial foi criado.");
  }
  return { createdEntries: (data.created_entries || []).map(importedEntryFromRow), existingEntries: (data.existing_entries || []).map(importedEntryFromRow), applied: (data.applied || []).map(appliedFromRow), alreadyAppliedCount: data.already_applied_count || 0, settledCount: data.settled_count || 0 };
}
