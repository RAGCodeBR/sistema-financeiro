// Pure extraction and reconciliation helpers. Amounts are integer centavos.
export type PdfToken = { text: string; x: number; y: number };
export type PdfPage = { page: number; tokens: PdfToken[] };
export type StatementTransaction = {
  id: string; date: string; description: string; amountCents: number;
  kind: "purchase" | "fee" | "credit" | "payment" | "future";
  page: number; sourceLine: string; detail: string; installment?: string;
  cardLast4?: string;
  sourceKey?: string;
};
export type CardStatement = {
  fingerprint: string; fileName: string; pageCount: number; dueDate: string;
  cardLast4: string; transactions: StatementTransaction[];
  currentTotalCents: number | null; invoiceTotalCents: number | null;
  previousBalanceCents: number | null; paymentsTotalCents: number | null;
  computedCurrentCents: number; warnings: string[];
  bankCode?: string; maskedCardNumber?: string;
};
export type ComparisonEntry = {
  id: string; kind?: string; description: string; beneficiary?: string;
  amount: number; date: string; paidDate?: string; unit?: string;
  category?: string; installment?: string; cardLast4?: string;
  purchaseDate?: string; cardSourceKey?: string;
  cardKey?: string; nature?: "PF" | "PJ";
  status?: "previsto" | "realizado"; notes?: string;
};
export type Match = { entry: ComparisonEntry; score: number; reason: string };
export type Reconciliation = { status: "uncompared" | "new" | "possible" | "matched" | "ambiguous"; matches: Match[] };
export type ReviewDecision = {
  status: "pending" | "classified" | "linked" | "unrecognized" | "refunded" | "refund_credit";
  nature: "" | "PJ" | "PF"; costCenter: string; category: string;
  linkedEntryId?: string; note: string;
  confirmedNew?: boolean;
  refund?: CardRefund;
};
export type CardRefund = { sourceKey: string; amountCents: number; date: string; note: string; creditSourceKey?: string };
export const normalizeStatementText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function brlCents(text: string): number {
  const clean = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!/^-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(clean)) throw new Error(`Valor inválido: ${text}`);
  return Math.round(Number(clean.replace(/\./g, "").replace(",", ".")) * 100);
}
export function pdfLines(tokens: PdfToken[]): { text: string; y: number }[] {
  const lines: { tokens: PdfToken[]; y: number }[] = [];
  for (const token of [...tokens].filter(t => t.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find(l => Math.abs(l.y - token.y) < 2.2);
    if (!line) { line = { y: token.y, tokens: [] }; lines.push(line); }
    line.tokens.push(token);
  }
  return lines.sort((a, b) => b.y - a.y).map(l => ({ y: l.y, text: l.tokens.sort((a, b) => a.x - b.x).map(t => t.text.trim()).join(" ").replace(/\s+/g, " ") }));
}
const moneyEnd = /(-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s*$/;
function yearDate(shortDate: string, dueDate: string): string {
  const [day, month] = shortDate.split("/").map(Number);
  const dueYear = Number(dueDate.slice(0, 4)), dueMonth = Number(dueDate.slice(5, 7));
  const year = dueYear - (month > dueMonth ? 1 : 0);
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("A fatura contém uma data de compra inválida.");
  return value;
}
export function parseItauStatement(pages: PdfPage[], fileName = "fatura.pdf", fingerprint = ""): CardStatement {
  const allLines = pages.flatMap(p => pdfLines(p.tokens).map(l => l.text));
  const allText = allLines.join("\n");
  const due = allText.match(/(?:Vencimento:\s*|Com vencimento em:\s*)(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!due) throw new Error("Não foi possível identificar o vencimento. Esta prévia lê o modelo de fatura Itaú enviado; PDFs digitalizados precisam de OCR.");
  const dueDate = `${due[3]}-${due[2]}-${due[1]}`;
  const cardLast4 = allText.match(/\d{4}[.\s*-]+(?:X{4}|\*{4})[.\s*-]+(?:X{4}|\*{4})[.\s*-]+(\d{4})/i)?.[1] || "";
  const maskedCardNumber = allText.match(/\d{4}[.\s*-]+(?:X{4}|\*{4})[.\s*-]+(?:X{4}|\*{4})[.\s*-]+\d{4}/i)?.[0].replace(/[^\dX*]/gi, "").replace(/\*/g, "X").toUpperCase();
  function summary(label: RegExp): number | null {
    for (const page of pages) {
      const anchor = page.tokens.find(t => label.test(normalizeStatementText(t.text)));
      if (!anchor) continue;
      const values = page.tokens.filter(t => Math.abs(t.y - anchor.y) < 2.2 && t.x > anchor.x && /^-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(t.text.trim())).sort((a, b) => a.x - b.x);
      if (values.length) return brlCents(values.at(-1)!.text);
    }
    const line = allLines.find(l => label.test(normalizeStatementText(l)));
    const value = line?.match(moneyEnd)?.[1];
    return value ? brlCents(value) : null;
  }
  const transactions: StatementTransaction[] = [], warnings: string[] = [];
  for (const page of pages) {
    // Column starts come from table headings, not the page midpoint: this Itaú
    // template has an asymmetric margin and amounts extend across the midpoint.
    const anchors: number[] = [];
    for (const t of page.tokens) {
      if (/^(lancamentos compras e saques|lancamentos internacionais|lancamentos produtos e servicos|pagamentos efetuados|compras parceladas proximas faturas)$/.test(normalizeStatementText(t.text)) && !anchors.some(x => Math.abs(x - t.x) < 24)) anchors.push(t.x);
    }
    anchors.sort((a, b) => a - b);
    const boundaries = anchors.slice(1).map(x => x - 8);
    const columns = Array.from({ length: boundaries.length + 1 }, () => [] as PdfToken[]);
    for (const t of page.tokens) columns[boundaries.filter(b => t.x >= b).length].push(t);
    for (const column of columns) {
      let section: "purchase" | "international" | "fee" | "payment" | "future" | null = null;
      let last: StatementTransaction | null = null;
      for (const { text } of pdfLines(column)) {
        const normalized = normalizeStatementText(text);
        if (/^pagamentos efetuados/.test(normalized)) { section = "payment"; last = null; continue; }
        if (/^lancamentos compras e saques/.test(normalized)) { section = "purchase"; last = null; continue; }
        if (/^lancamentos internacionais/.test(normalized)) { section = "international"; last = null; continue; }
        if (/^lancamentos produtos e servicos/.test(normalized)) { section = "fee"; last = null; continue; }
        if (/^compras parceladas proximas faturas/.test(normalized)) { section = "future"; last = null; continue; }
        if (/^(limites de credito|encargos cobrados|novo teto|fique atento|simulacao|total dos lancamentos atuais|proxima fatura|demais faturas|total para proximas)/.test(normalized)) { section = null; last = null; continue; }
        if (section === "international" && /^repasse de iof em r/.test(normalized)) {
          const value = text.match(moneyEnd)?.[1];
          if (value && brlCents(value) !== 0) transactions.push({ id: `${page.page}-${transactions.length}`, date: dueDate, description: "IOF sobre compras internacionais", amountCents: brlCents(value), kind: "fee", page: page.page, sourceLine: text, detail: "Encargo consolidado da fatura; data de referência: vencimento.", cardLast4 });
          last = null; continue;
        }
        if (/^(?:[psl] )?(total |lancamentos no cartao|lancamentos produtos e servicos)\b/.test(normalized)) { last = null; continue; }
        if (!section) continue;
        const row = text.match(/^(\d{2}\/\d{2})\s+(.+?)\s+(-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})$/);
        if (row) {
          const amountCents = brlCents(row[3]);
          const installment = row[2].match(/\s(\d{2}\/\d{2})\s*$/)?.[1];
          last = { id: `${page.page}-${transactions.length}`, date: yearDate(row[1], dueDate), description: row[2].replace(/\s\d{2}\/\d{2}\s*$/, "").trim(), amountCents, kind: section === "payment" ? "payment" : section === "future" ? "future" : amountCents < 0 ? "credit" : section === "fee" ? "fee" : "purchase", page: page.page, sourceLine: text, detail: "", installment, cardLast4 };
          transactions.push(last);
        } else if (/^\d{2}\/\d{2}\b/.test(text)) {
          warnings.push(`Página ${page.page}: uma linha com data não pôde ser lida: ${text}`); last = null;
        } else if (last && !/^(data |valor |estabelecimento|dolar |\d|total |lancamentos )/.test(normalized) && text.length < 110) {
          last.detail = [last.detail, text].filter(Boolean).join(" · ");
        }
      }
    }
  }
  const currentTotalCents = summary(/^(?:l )?total dos lancamentos atuais\b/) ?? summary(/^lancamentos atuais\b/);
  const invoiceTotalCents = summary(/^total desta fatura\b/);
  const previousBalanceCents = summary(/^total da fatura anterior\b/);
  const paymentsTotalCents = summary(/^pagamentos efetuados\b/);
  const computedCurrentCents = transactions.filter(t => t.kind !== "payment" && t.kind !== "future").reduce((s, t) => s + t.amountCents, 0);
  if (!transactions.length) throw new Error("Nenhuma movimentação foi extraída. Verifique o modelo do PDF; arquivos de imagem precisam de OCR.");
  if (currentTotalCents === null) warnings.push("O total de lançamentos atuais não foi localizado; confira os valores no PDF.");
  else if (computedCurrentCents !== currentTotalCents) warnings.push(`A soma dos itens difere do total de lançamentos atuais em ${((computedCurrentCents - currentTotalCents) / 100).toFixed(2)} reais. Revise a leitura antes de concluir.`);
  if (invoiceTotalCents !== null && previousBalanceCents !== null && paymentsTotalCents !== null && previousBalanceCents + paymentsTotalCents + computedCurrentCents !== invoiceTotalCents) warnings.push("O saldo anterior, os pagamentos e os itens lidos não fecham com o total a pagar.");
  if (!cardLast4) warnings.push("O final do cartão não foi identificado; confirme a origem da fatura.");
  return { fingerprint, fileName, pageCount: pages.length, dueDate, cardLast4, transactions, currentTotalCents, invoiceTotalCents, previousBalanceCents, paymentsTotalCents, computedCurrentCents, warnings, bankCode: "itau", maskedCardNumber };
}
function merchantSimilarity(a: string, b: string): number {
  const left = normalizeStatementText(a), right = normalizeStatementText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) >= 7 && (left.includes(right) || right.includes(left))) return .9;
  const aTokens = left.split(" ").filter(t => t.length > 2), bTokens = right.split(" ").filter(t => t.length > 2);
  return aTokens.filter(t => bTokens.includes(t)).length / Math.max(aTokens.length, bTokens.length, 1);
}
export function reconcileStatement(transactions: StatementTransaction[], entries: ComparisonEntry[] | null): Record<string, Reconciliation> {
  const result: Record<string, Reconciliation> = {};
  const claims = new Map<string, string[]>();
  for (const t of transactions) {
    if (entries === null) { result[t.id] = { status: "uncompared", matches: [] }; continue; }
    if (t.kind === "payment" || t.kind === "future" || t.amountCents <= 0) { result[t.id] = { status: "uncompared", matches: [] }; continue; }
    const matches: Match[] = [];
    for (const e of entries) {
      if (e.kind && !["despesa", "Despesa"].includes(e.kind)) continue;
      if (t.sourceKey && e.cardSourceKey === t.sourceKey) {
        matches.push({ entry: e, score: 100, reason: "Origem da fatura já registrada neste lançamento" });
        continue;
      }
      if (e.cardLast4 && t.cardLast4 && e.cardLast4 !== t.cardLast4) continue;
      if (e.installment && t.installment && e.installment.split("/").map(Number).join("/") !== t.installment.split("/").map(Number).join("/")) continue;
      const dayDelta = Math.min(...[e.purchaseDate, e.date, e.paidDate].filter(Boolean).map(date => Math.abs(Date.parse(`${date}T12:00:00Z`) - Date.parse(`${t.date}T12:00:00Z`)) / 86400000));
      const similarity = Math.max(merchantSimilarity(t.description, e.description), merchantSimilarity(t.description, e.beneficiary || ""));
      if (Math.round(e.amount * 100) !== t.amountCents) {
        if (Number.isFinite(dayDelta) && dayDelta <= 3 && similarity >= .85) matches.push({ entry: e, score: 70, reason: "Descrição e data semelhantes, mas o valor é diferente. Confira uma possível revisão ou ajuste da compra." });
        continue;
      }
      if (!Number.isFinite(dayDelta) || dayDelta > 45 || (dayDelta > 7 && similarity < .6)) continue;
      const score = similarity >= .85 && dayDelta <= 3 ? 95 : similarity >= .6 ? 80 : 55;
      matches.push({ entry: e, score, reason: `${similarity >= .6 ? "Descrição semelhante" : "Mesmo valor"} · ${Math.round(dayDelta)} dia(s) de diferença${!e.cardLast4 ? " · cartão não informado no lançamento" : ""}` });
    }
    matches.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
    result[t.id] = { status: matches.length > 1 ? "ambiguous" : matches[0]?.score >= 95 ? "matched" : matches.length ? "possible" : "new", matches };
    for (const m of matches) claims.set(m.entry.id, [...(claims.get(m.entry.id) || []), t.id]);
  }
  for (const ids of claims.values()) if (ids.length > 1) for (const id of ids) result[id].status = "ambiguous";
  return result;
}
export const emptyDecision = (): ReviewDecision => ({ status: "pending", nature: "", costCenter: "", category: "", note: "" });
export function currentTransactions(statement: CardStatement): StatementTransaction[] {
  return statement.transactions.filter(t => t.kind !== "payment" && t.kind !== "future");
}
export function reviewIsComplete(transaction: StatementTransaction, decision: ReviewDecision | undefined): boolean {
  if (!decision) return false;
  return decision.status === "linked" ? Boolean(decision.linkedEntryId) : decision.status === "classified" && Boolean(decision.nature && decision.costCenter && decision.category);
}
export function refundDecision(transaction: StatementTransaction, refunds: CardRefund[]): ReviewDecision | undefined {
  const refund = refunds.find(r => r.sourceKey === transaction.sourceKey || r.creditSourceKey === transaction.sourceKey);
  if (!refund) return;
  return { ...emptyDecision(), status: refund.sourceKey === transaction.sourceKey ? "refunded" : "refund_credit", note: refund.note, refund };
}
export function reviewIsResolved(transaction: StatementTransaction, decision: ReviewDecision | undefined): boolean {
  return reviewIsComplete(transaction, decision) || Boolean(decision?.refund && ["refunded", "refund_credit"].includes(decision.status));
}
