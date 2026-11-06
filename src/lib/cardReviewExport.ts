import { currentTransactions, reviewIsComplete, type CardStatement, type ReviewDecision, type StatementTransaction } from "./cardStatement";
import { getStatementPayment, type AppliedStatementItem } from "./cardImport";

export type CardReviewExportOptions = {
  statement: CardStatement;
  decisions: Record<string, ReviewDecision>;
  comparison: { available: boolean; count: number; source: string };
  applied?: AppliedStatementItem[];
};
const formatDate = (iso: string) => iso ? iso.split("-").reverse().join("/") : "";
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const kindNames = { purchase: "Compra", fee: "Encargo", credit: "Crédito / ajuste", payment: "Pagamento da fatura", future: "Parcela futura" };
const localReviewNotice = "A exportação deste relatório não cria nem altera lançamentos. A criação exige confirmação na conferência.";
const dateNotice = "Datas de referência das compras. IOF consolidado usa o vencimento da fatura. Parcelas futuras mostram a data original da compra, sem indicar vencimento futuro.";
const currencyFormat = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

function buildReport(options: CardReviewExportOptions) {
  const { statement, decisions, comparison } = options;
  const current = currentTransactions(statement);
  const reviewed = current.filter(t => reviewIsComplete(t, decisions[t.id]));
  const unrecognized = current.filter(t => decisions[t.id]?.status === "unrecognized");
  const groups = new Map<string, { nature: string; center: string; category: string; count: number; totalCents: number }>();
  for (const t of current) {
    const d = decisions[t.id], complete = reviewIsComplete(t, d);
    const nature = complete ? d.nature || "Não informada" : "A distribuir";
    const center = complete ? d.costCenter || "Não informado" : "Pendente de validação";
    const category = complete ? d.category || "Não informada" : "";
    const key = JSON.stringify([nature, center, category]);
    const group = groups.get(key) || { nature, center, category, count: 0, totalCents: 0 };
    group.count++; group.totalCents += t.amountCents; groups.set(key, group);
  }
  const row = (t: StatementTransaction) => {
    const d = decisions[t.id];
    const applied = options.applied?.find(item => item.sourceKey === t.sourceKey);
    const status = t.kind === "payment" ? "Pagamento - fora das despesas atuais" : t.kind === "future" ? "Previsão - fora da fatura atual" : applied ? applied.status === "offset" ? "Compensada por créditos" : applied.status === "linked" ? "Vínculo confirmado" : "Lançada" : d?.status === "unrecognized" ? "Não reconhecida - em apuração" : reviewIsComplete(t, d) ? d.status === "linked" ? "Vínculo confirmado" : "Classificada" : "A validar";
    return { date: formatDate(t.date), description: t.description, kind: kindNames[t.kind], value: t.amountCents / 100,
      nature: d?.nature || "", center: d?.costCenter || "", category: d?.category || "", status,
      distributionNature: reviewIsComplete(t, d) ? d.nature || "" : "",
      installment: t.installment || "", note: d?.note || "", detail: t.detail, page: t.page, linkedEntryId: d?.linkedEntryId || "" };
  };
  return {
    current, reviewed, unrecognized, pending: current.length - reviewed.length,
    groups: [...groups.values()], currentRows: current.map(row),
    payments: statement.transactions.filter(t => t.kind === "payment").map(row),
    future: statement.transactions.filter(t => t.kind === "future").map(row),
    comparisonLabel: comparison.available ? `${comparison.count} registros - ${comparison.source}. A cobertura depende do período e dos filtros da base.` : "Não carregada. Os itens ainda não foram comparados com os lançamentos existentes.",
  };
}

export async function exportCardReviewExcel(options: CardReviewExportOptions) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinCore";
  const { statement } = options, report = buildReport(options);
  const summary = workbook.addWorksheet("Resumo");
  summary.columns = [{ width: 34 }, { width: 105 }];
  summary.addRow(["FinCore | Conferência da fatura Itaú"]);
  summary.addRow(["Situação", localReviewNotice]);
  summary.addRow(["Cartão (final)", statement.cardLast4 || "Não identificado"]);
  summary.addRow(["Vencimento da fatura", formatDate(statement.dueDate)]);
  const payment = getStatementPayment(statement);
  summary.addRow(["Pagamento identificado", payment.state === "paid" ? `Pago em ${formatDate(payment.paidDate)}` : payment.state === "open" ? "A pagar" : "Não comprovado - previsto"]);
  summary.addRow(["Evidência do pagamento", payment.explanation]);
  summary.addRow(["Arquivo de origem", statement.fileName]);
  for (const [label, cents] of [
    ["Movimentações atuais", statement.computedCurrentCents], ["Total a pagar", statement.invoiceTotalCents],
    ["Saldo da fatura anterior", statement.previousBalanceCents], ["Pagamentos efetuados", statement.paymentsTotalCents],
  ] as const) {
    const row = summary.addRow([label, cents === null ? "Não identificado" : cents / 100]);
    if (cents !== null) row.getCell(2).numFmt = currencyFormat;
  }
  for (const [label, value] of [["Movimentações atuais (quantidade)", report.current.length], ["Itens validados", report.reviewed.length], ["Itens pendentes", report.pending], ["Compras não reconhecidas", report.unrecognized.length], ["Base de comparação", report.comparisonLabel], ["Datas dos itens", dateNotice], ["Pagamentos e parcelas futuras", "Exibidos em abas separadas. Não são somados às despesas atuais."], ["Validação da leitura", statement.warnings.length ? "Leitura com pendências; confira os avisos abaixo." : "Soma dos itens conferida com o PDF."]] as const) summary.addRow([label, value]);
  for (const warning of statement.warnings) summary.addRow(["Aviso de leitura", warning]);
  summary.getColumn(1).font = { bold: true, color: { argb: "FF304D73" } };
  summary.getColumn(2).alignment = { vertical: "top", wrapText: true };
  summary.eachRow((row, index) => { if (index !== 1) row.height = 34; });
  summary.getRow(1).font = { bold: true, size: 16, color: { argb: "FF172744" } };
  summary.getRow(1).height = 30;
  summary.views = [{ state: "frozen", ySplit: 1 }];

  function styleSheet(sheet: import("exceljs").Worksheet, currencyKey: string) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172744" } };
    sheet.getRow(1).height = 30;
    sheet.getColumn(currencyKey).numFmt = currencyFormat;
    sheet.eachRow((row, index) => { row.alignment = { vertical: "top", wrapText: true }; if (index > 1) row.height = 42; });
  }
  const distribution = workbook.addWorksheet("Distribuição");
  distribution.columns = [{ header: "PJ / PF", key: "nature", width: 20 }, { header: "Centro de custo", key: "center", width: 28 }, { header: "Categoria", key: "category", width: 28 }, { header: "Quantidade", key: "count", width: 15 }, { header: "Valor (R$)", key: "value", width: 20 }];
  for (const group of report.groups) distribution.addRow({ ...group, value: group.totalCents / 100 });
  styleSheet(distribution, "value");
  function addTransactions(name: string, rows: ReturnType<typeof buildReport>["currentRows"]) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = [
      { header: "Data de referência", key: "date", width: 20 }, { header: "Descrição", key: "description", width: 40 },
      { header: "Tipo", key: "kind", width: 22 }, { header: "Valor (R$)", key: "value", width: 19 },
      { header: "PJ / PF", key: "nature", width: 12 }, { header: "Centro de custo", key: "center", width: 24 },
      { header: "Categoria", key: "category", width: 25 }, { header: "Situação da conferência", key: "status", width: 38 },
      { header: "Parcela", key: "installment", width: 12 }, { header: "Observação", key: "note", width: 48 },
      { header: "Detalhe no PDF", key: "detail", width: 48 }, { header: "Página do PDF", key: "page", width: 17 },
      { header: "Lançamento vinculado", key: "linkedEntryId", width: 38 },
    ];
    sheet.addRows(rows); styleSheet(sheet, "value");
  }
  addTransactions("Movimentações atuais", report.currentRows);
  addTransactions("Pagamentos", report.payments);
  addTransactions("Parcelas futuras", report.future);
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `conferencia-itau-${statement.dueDate}.xlsx`);
  return workbook;
}

export async function exportCardReviewPdf(options: CardReviewExportOptions) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const { statement } = options, report = buildReport(options);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(63, 80, 105);
  let y = 34;
  const paragraphs = [localReviewNotice,
    `Movimentações atuais: ${money(statement.computedCurrentCents)} | Total a pagar: ${statement.invoiceTotalCents === null ? "Não identificado" : money(statement.invoiceTotalCents)}`,
    `Saldo anterior: ${statement.previousBalanceCents === null ? "Não identificado" : money(statement.previousBalanceCents)} | Pagamentos: ${statement.paymentsTotalCents === null ? "Não identificado" : money(statement.paymentsTotalCents)}`,
    `${report.current.length} itens atuais | ${report.reviewed.length} validados | ${report.pending} pendentes | ${report.unrecognized.length} não reconhecidos`,
    `Pagamento identificado: ${getStatementPayment(statement).state === "paid" ? `pago em ${formatDate(getStatementPayment(statement).paidDate)}` : getStatementPayment(statement).state === "open" ? "a pagar" : "não comprovado - previsto"}`,
    getStatementPayment(statement).explanation,
    `Comparação: ${report.comparisonLabel}`, dateNotice];
  for (const paragraph of paragraphs) { const lines = doc.splitTextToSize(paragraph, 271); doc.text(lines, 13, y); y += lines.length * 4.3 + 2; }
  const table = (title: string, head: string[], body: (string | number)[][], columnStyles?: Record<number, { cellWidth: number; halign?: "right" | "left" }>, options?: { color?: [number, number, number]; foot?: (string | number)[][] }) => {
    if (y > 167) { doc.addPage(); y = 34; }
    doc.setTextColor(23, 39, 68); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(title, 13, y);
    autoTable(doc, { startY: y + 4, head: [head], body, theme: "striped",
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: options?.color || [23, 39, 68] }, columnStyles,
      foot: options?.foot, showFoot: "lastPage",
      footStyles: { fillColor: [239, 244, 252], textColor: [45, 70, 108], fontStyle: "bold" },
      margin: { top: 32, left: 13, right: 13, bottom: 16 },
    });
    y = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 12;
  };
  if (statement.warnings.length) table("Avisos da leitura - revisar antes de concluir", ["Aviso"], statement.warnings.map(w => [w]));
  let renderedSections = 0;
  for (const section of [
    { nature: "PJ", title: "PJ - Pessoa jurídica", subtotal: "Subtotal PJ", color: [37, 99, 210] as [number, number, number] },
    { nature: "PF", title: "PF - Pessoa física", subtotal: "Subtotal PF", color: [126, 83, 173] as [number, number, number] },
    { nature: "", title: "Pendências - sem distribuição PJ/PF", subtotal: "Subtotal a distribuir", color: [150, 112, 44] as [number, number, number] },
  ]) {
    const rows = report.currentRows.filter(row => row.distributionNature === section.nature);
    if (!rows.length) continue;
    const groups = report.groups.filter(group => section.nature ? group.nature === section.nature : !["PJ", "PF"].includes(group.nature));
    if (renderedSections++) { doc.addPage(); y = 34; }
    table(`${section.title} - distribuição`, ["Centro de custo", "Categoria", "Itens", "Total"], groups.map(group => [group.center, group.category || "-", group.count, money(group.totalCents)]),
      { 0: { cellWidth: 80 }, 1: { cellWidth: 130 }, 2: { cellWidth: 20, halign: "right" }, 3: { cellWidth: 41, halign: "right" } },
      { color: section.color, foot: [[section.subtotal, "", rows.length, money(rows.reduce((sum, row) => sum + Math.round(row.value * 100), 0))]] });
    table(`${section.title} - movimentações`, ["Data", "Descrição / tipo", "Valor (R$)", "Centro de custo", "Categoria", "Situação", "Parcela", "Observação / detalhe", "Pág."], rows.map(row => [row.date, `${row.description}\n${row.kind}`, money(Math.round(row.value * 100)), row.center || "-", row.category || "-", row.status, row.installment || "-", [row.note, row.detail].filter(Boolean).join("\n") || "-", row.page]),
      { 0: { cellWidth: 20 }, 1: { cellWidth: 62 }, 2: { cellWidth: 23, halign: "right" }, 3: { cellWidth: 30 }, 4: { cellWidth: 32 }, 5: { cellWidth: 29 }, 6: { cellWidth: 14 }, 7: { cellWidth: 50 }, 8: { cellWidth: 11 } }, { color: section.color });
  }
  if (report.payments.length || report.future.length) { doc.addPage(); y = 34; }
  if (report.payments.length) table("Pagamentos da fatura - não somar como novas despesas", ["Data", "Descrição", "Valor", "Página do PDF"], report.payments.map(r => [r.date, r.description, money(Math.round(r.value * 100)), r.page]));
  if (report.future.length) table("Parcelas futuras - fora das despesas atuais", ["Data original da compra", "Descrição", "Valor", "Parcela", "Página do PDF"], report.future.map(r => [r.date, r.description, money(Math.round(r.value * 100)), r.installment, r.page]));
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page); doc.setFillColor(23, 39, 68); doc.rect(0, 0, 297, 25, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255); doc.setFontSize(15); doc.text("FinCore | Conferência da fatura Itaú", 13, 11);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`Cartão final ${statement.cardLast4 || "não identificado"} | Vencimento: ${formatDate(statement.dueDate)}`, 13, 19);
    doc.setTextColor(130, 143, 161); doc.setFontSize(8); doc.text("FinCore - relatório de conferência de fatura", 13, 202); doc.text(`${page} / ${doc.getNumberOfPages()}`, 284, 202, { align: "right" });
  }
  doc.save(`conferencia-itau-${statement.dueDate}.pdf`);
  return doc;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
