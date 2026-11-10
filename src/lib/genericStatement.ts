import { brlCents, currentTransactions, normalizeStatementText, pdfLines, type CardStatement, type PdfPage, type StatementTransaction } from "./cardStatement.ts";
import { statementBanks } from "./cardBanks.ts";

const amountEnd = /(?:R\$\s*)?(-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?:\s*([CD]))?\s*$/i;
export function statementDate(value: string, dueDate = ""): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  const short = value.trim().match(/^(\d{2})[/-](\d{2})(?:[/-](\d{2}|\d{4}))?$/);
  if (short) {
    const [, day, month, givenYear] = short;
    const year = givenYear ? Number(givenYear.length === 2 ? `20${givenYear}` : givenYear) : dueDate ? Number(dueDate.slice(0, 4)) - (Number(month) > Number(dueDate.slice(5, 7)) ? 1 : 0) : 0;
    if (year >= 1900 && year <= 2200) return statementDate(`${year}-${month}-${day}`);
  }
  throw new Error(`Confira a data “${value || "não informada"}”. Use dia/mês/ano ou escolha o vencimento para completar o ano.`);
}
export function genericStatement(pages: PdfPage[], fileName: string, fingerprint: string): CardStatement {
  const lines = pages.flatMap(p => pdfLines(p.tokens).map(l => ({ ...l, page: p.page })));
  const text = lines.map(l => l.text).join("\n"), normalized = normalizeStatementText(text);
  const bank = statementBanks.find(b => new RegExp(`\\b${normalizeStatementText(b.name)}\\b`).test(normalized) || new RegExp(`\\b${b.code.replace(/-/g, " ")}\\b`).test(normalized));
  const dueMatch = text.match(/(?:vencimento|vence(?:\s+em)?|venc\.?)[^\d\n]{0,25}(\d{2}[/-]\d{2}[/-]\d{4})/i);
  let dueDate = "";
  if (dueMatch) { try { dueDate = statementDate(dueMatch[1]); } catch { /* Keep unidentified dates for assisted review. */ } }
  const maskedCardNumber = text.match(/\d{4}[.\s*-]+(?:X{4}|\*{4})[.\s*-]+(?:X{4}|\*{4})[.\s*-]+\d{4}/i)?.[0].replace(/[^\dX*]/gi, "").replace(/\*/g, "X").toUpperCase();
  const cardLast4 = maskedCardNumber?.slice(-4) || text.match(/(?:cart[aã]o[^\n\d]{0,15}(?:final\s*)?|final\s*(?:do cart[aã]o\s*)?)[*X.\s-]*(\d{4})(?!\d)/i)?.[1] || "";
  function total(pattern: RegExp): number | null {
    const line = lines.find(l => pattern.test(normalizeStatementText(l.text)) && amountEnd.test(l.text));
    const found = line?.text.match(amountEnd);
    return found ? brlCents(found[1]) * (found[2]?.toUpperCase() === "C" ? -1 : 1) : null;
  }
  const transactions: StatementTransaction[] = [];
  let section: "current" | "future" | "payment" = "current";
  for (const line of lines) {
    const normalizedLine = normalizeStatementText(line.text);
    if (/^(?:compras parceladas )?proximas faturas|^parcelas futuras/.test(normalizedLine)) { section = "future"; continue; }
    if (/^(?:lancamentos|compras|transacoes|movimentacoes)(?:\s|$)/.test(normalizedLine)) section = "current";
    if (/^pagamentos efetuados$/.test(normalizedLine)) { section = "payment"; continue; }
    const row = line.text.match(/^(\d{2}[/-]\d{2}(?:[/-](?:\d{4}|\d{2}))?)\s+(.+?)\s+(?:R\$\s*)?(-?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?:\s*([CD]))?\s*$/i);
    if (!row) continue;
    let date = row[1];
    try { date = statementDate(date, dueDate); } catch { /* A date with no year needs the invoice due date first. */ }
    let amountCents = brlCents(row[3]);
    const description = row[2].trim(), normalizedDescription = normalizeStatementText(description);
    const payment = /\bpagamento\b|\bdebito automatico\b/.test(normalizedDescription) || section === "payment";
    if (row[4]?.toUpperCase() === "C" || payment) amountCents = -Math.abs(amountCents);
    const installment = description.match(/(?:parcela\s*)?(\d{1,2}\/\d{1,2})\s*$/i)?.[1];
    transactions.push({ id: `generic-${transactions.length}`, date, description: description.replace(/\s+(?:parcela\s*)?\d{1,2}\/\d{1,2}\s*$/i, ""), amountCents, kind: payment ? "payment" : section === "future" ? "future" : amountCents < 0 ? "credit" : /\biof\b|\banuidade\b|\btarifa\b|\bjuros\b/.test(normalizedDescription) ? "fee" : "purchase", page: line.page, sourceLine: line.text, detail: "Leitura assistida: confira com o documento original.", installment, cardLast4 });
  }
  return { fingerprint, fileName, pageCount: pages.length, bankCode: bank?.code || "", bankName: bank?.name || "", dueDate, cardLast4, maskedCardNumber, transactions,
    currentTotalCents: total(/^(?:total (?:dos |das |de )?(?:lancamentos|compras|movimentacoes)(?: atuais)?|lancamentos atuais|compras do periodo)\b/),
    invoiceTotalCents: total(/^(?:total (?:desta |da |a pagar da )?fatura|valor (?:total )?da fatura|total a pagar)\b/),
    previousBalanceCents: total(/^(?:total da fatura anterior|saldo anterior|saldo da fatura anterior)\b/),
    paymentsTotalCents: total(/^(?:pagamentos efetuados|pagamentos recebidos|pagamentos no periodo)\b/),
    computedCurrentCents: transactions.filter(t => !["payment", "future"].includes(t.kind)).reduce((sum, t) => sum + t.amountCents, 0), warnings: [], readingMethod: "assisted", reviewedExtraction: false };
}
export function validateAssistedStatement(input: CardStatement): CardStatement {
  if (!input.reviewedExtraction) throw new Error("Confirme que conferiu os dados e todos os itens com o documento original.");
  if (!input.bankCode || !/^[a-z0-9-]{2,40}$/.test(input.bankCode)) throw new Error("Identifique o banco antes de continuar.");
  if (!statementBanks.some(bank => bank.code === input.bankCode) && !input.bankName?.trim()) throw new Error("Informe o nome do banco para identificar este cartão.");
  if (!/^\d{4}$/.test(input.cardLast4)) throw new Error("Informe os quatro últimos números do cartão.");
  const dueDate = statementDate(input.dueDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error("Confira o vencimento da fatura.");
  if (input.maskedCardNumber && (!/^(?:\d{4}|\d{4}X{4,16}\d{4})$/.test(input.maskedCardNumber) || !input.maskedCardNumber.endsWith(input.cardLast4))) throw new Error("Use apenas a identificação mascarada, terminando com o final informado. Não informe o número completo do cartão.");
  if (!input.transactions.length || input.transactions.length > 5000) throw new Error("Confira os itens extraídos. Inclua ao menos uma movimentação e use até 5.000 itens por fatura.");
  const transactions = input.transactions.map((t, index) => {
    if (!Number.isSafeInteger(t.amountCents) || Math.abs(t.amountCents) > 999999999999 || t.amountCents === 0 || !["purchase", "fee", "credit", "payment", "future"].includes(t.kind) || (t.kind === "credit" && t.amountCents >= 0) || (["purchase", "fee", "future"].includes(t.kind) && t.amountCents < 0) || (t.kind === "payment" && t.amountCents >= 0)) throw new Error(`Confira o valor e o tipo da movimentação ${index + 1}. Créditos e pagamentos devem ter valor negativo.`);
    if (!t.description.trim() || t.description.trim().length > 300 || (t.installment && !/^\d{1,2}\/\d{1,2}$/.test(t.installment))) throw new Error(`Confira a descrição e a parcela da movimentação ${index + 1}.`);
    return { ...t, id: `generic-${index}`, sourceKey: undefined, date: statementDate(t.date, dueDate), description: t.description.trim(), cardLast4: input.cardLast4 };
  });
  const computedCurrentCents = currentTransactions({ ...input, transactions }).reduce((sum, t) => sum + t.amountCents, 0);
  if (!Number.isSafeInteger(input.currentTotalCents) || input.currentTotalCents !== computedCurrentCents) throw new Error("A soma dos itens não fecha com a movimentação atual informada. Confira compras, encargos e créditos; pagamentos e parcelas futuras ficam separados.");
  for (const value of [input.invoiceTotalCents, input.previousBalanceCents, input.paymentsTotalCents]) if (value !== null && !Number.isSafeInteger(value)) throw new Error("Confira os valores do resumo da fatura.");
  if (input.invoiceTotalCents !== null && input.previousBalanceCents !== null && input.paymentsTotalCents !== null && input.previousBalanceCents + input.paymentsTotalCents + computedCurrentCents !== input.invoiceTotalCents) throw new Error("Saldo anterior, pagamentos e movimentações não fecham com o total a pagar.");
  return { ...input, dueDate, transactions, computedCurrentCents, warnings: [], readingMethod: input.readingMethod === "ocr" ? "ocr" : "assisted" };
}
