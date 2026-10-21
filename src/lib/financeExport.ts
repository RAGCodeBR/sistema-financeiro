export type ExportEntry = {
  id: string;
  date: string;
  kind: "receita" | "despesa";
  status: "previsto" | "realizado";
  unit: string;
  account: string;
  category: string;
  description: string;
  beneficiary?: string;
  amount: number;
  juros?: number;
  discount?: number;
  paidDate?: string;
  installment?: string;
  recurrence?: string;
  pix?: string;
  notes?: string;
  attachments?: string[];
};

export type FinanceExport = {
  title: string;
  filterDescription: string;
  entries: ExportEntry[];
  includeCategories?: boolean;
};

export type ExportCriteria = {
  from?: string;
  to?: string;
  dateField?: "vencimento" | "liquidacao";
  view?: ExportView;
  today?: string;
  kind?: "todos" | ExportEntry["kind"];
  status?: "todos" | ExportEntry["status"];
  unit?: string;
  account?: string;
  category?: string;
  beneficiary?: string;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  pix?: "todos" | "com" | "sem";
  notes?: "todos" | "com" | "sem";
  attachments?: "todos" | "com" | "sem";
  paymentAdjustment?: "todos" | "juros" | "desconto";
};

export type ExportView = "todos" | "despesas" | "receitas" | "a-pagar" | "a-receber" | "pagas" | "recebidas" | "atrasadas" | "atrasadas-pagar" | "atrasadas-receber" | "recorrentes" | "parcelados" | "unicos";

export const exportViewLabels: Record<ExportView, string> = {
  todos: "Todos os lançamentos",
  despesas: "Todas as despesas",
  receitas: "Todas as receitas",
  "a-pagar": "Contas a pagar",
  "a-receber": "Contas a receber",
  pagas: "Despesas pagas",
  recebidas: "Receitas recebidas",
  atrasadas: "Todas as contas em atraso",
  "atrasadas-pagar": "Contas a pagar atrasadas",
  "atrasadas-receber": "Contas a receber atrasadas",
  recorrentes: "Lançamentos recorrentes",
  parcelados: "Lançamentos parcelados",
  unicos: "Lançamentos únicos",
};

export type ExportPeriod = "todos" | "hoje" | "semana" | "mes" | "mes-anterior" | "ano" | "personalizado";

export function exportPeriodRange(period: ExportPeriod, from = "", to = "", today = new Date()) {
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const year = today.getFullYear();
  const month = today.getMonth();
  if (period === "hoje") return { from: key(today), to: key(today) };
  if (period === "semana") {
    const monday = new Date(year, month, today.getDate() - ((today.getDay() + 6) % 7));
    return { from: key(monday), to: key(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
  }
  if (period === "mes") return { from: key(new Date(year, month, 1)), to: key(new Date(year, month + 1, 0)) };
  if (period === "mes-anterior") return { from: key(new Date(year, month - 1, 1)), to: key(new Date(year, month, 0)) };
  if (period === "ano") return { from: `${year}-01-01`, to: `${year}-12-31` };
  return period === "personalizado" ? { from, to } : { from: "", to: "" };
}

function matchesView(entry: ExportEntry, view: ExportView, today: string) {
  switch (view) {
    case "despesas": return entry.kind === "despesa";
    case "receitas": return entry.kind === "receita";
    case "a-pagar": return entry.kind === "despesa" && entry.status === "previsto";
    case "a-receber": return entry.kind === "receita" && entry.status === "previsto";
    case "pagas": return entry.kind === "despesa" && entry.status === "realizado";
    case "recebidas": return entry.kind === "receita" && entry.status === "realizado";
    case "atrasadas": return entry.status === "previsto" && entry.date < today;
    case "atrasadas-pagar": return entry.kind === "despesa" && entry.status === "previsto" && entry.date < today;
    case "atrasadas-receber": return entry.kind === "receita" && entry.status === "previsto" && entry.date < today;
    case "recorrentes": return entry.recurrence === "mensal";
    case "parcelados": return entry.recurrence !== "mensal" && Boolean(entry.installment);
    case "unicos": return entry.recurrence !== "mensal" && !entry.installment;
    default: return true;
  }
}

export function filterFinanceEntries(entries: ExportEntry[], criteria: ExportCriteria) {
  const term = criteria.search?.trim().toLocaleLowerCase("pt-BR") || "";
  const now = new Date();
  const today = criteria.today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return entries.filter((entry) => {
    const date = criteria.dateField === "liquidacao" ? entry.paidDate : entry.date;
    const amount = effectiveAmount(entry);
    return matchesView(entry, criteria.view || "todos", today) &&
    (!criteria.from || Boolean(date && date >= criteria.from)) &&
    (!criteria.to || Boolean(date && date <= criteria.to)) &&
    (!criteria.kind || criteria.kind === "todos" || entry.kind === criteria.kind) &&
    (!criteria.status || criteria.status === "todos" || entry.status === criteria.status) &&
    (!criteria.unit || entry.unit === criteria.unit) &&
    (!criteria.account || entry.account === criteria.account) &&
    (!criteria.category || entry.category === criteria.category) &&
    (!criteria.beneficiary || entry.beneficiary === criteria.beneficiary) &&
    (criteria.minAmount === undefined || amount >= criteria.minAmount) &&
    (criteria.maxAmount === undefined || amount <= criteria.maxAmount) &&
    (!criteria.pix || criteria.pix === "todos" || Boolean(entry.pix?.trim()) === (criteria.pix === "com")) &&
    (!criteria.notes || criteria.notes === "todos" || Boolean(entry.notes?.trim()) === (criteria.notes === "com")) &&
    (!criteria.attachments || criteria.attachments === "todos" || Boolean(entry.attachments?.length) === (criteria.attachments === "com")) &&
    (!criteria.paymentAdjustment || criteria.paymentAdjustment === "todos" ||
      (criteria.paymentAdjustment === "juros" ? (entry.juros || 0) > 0 : (entry.discount || 0) > 0)) &&
    (!term || `${entry.description} ${entry.beneficiary || ""} ${entry.category} ${entry.unit} ${entry.account} ${entry.pix || ""} ${entry.notes || ""}`.toLocaleLowerCase("pt-BR").includes(term));
  });
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const displayDate = (value?: string) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : "";
const excelDate = (value?: string) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : null;
const effectiveAmount = (entry: ExportEntry) =>
  entry.amount + (entry.kind === "despesa" && entry.status === "realizado"
    ? (entry.juros || 0) - (entry.discount || 0)
    : 0);
const safeName = (title: string) =>
  title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fileName = (options: FinanceExport, extension: string) =>
  `fincore-${safeName(options.title)}-${new Date().toISOString().slice(0, 10)}.${extension}`;

export function summarizeEntries(entries: ExportEntry[]) {
  return entries.reduce((result, entry) => {
    const value = effectiveAmount(entry);
    if (entry.kind === "receita") {
      result.receitas += value;
      result[entry.status === "realizado" ? "recebido" : "aReceber"] += value;
    } else {
      result.despesas += value;
      result[entry.status === "realizado" ? "pago" : "aPagar"] += value;
    }
    return result;
  }, { receitas: 0, despesas: 0, recebido: 0, aReceber: 0, pago: 0, aPagar: 0 });
}

export function categoriesForExport(entries: ExportEntry[]) {
  const rows = new Map<string, { category: string; unit: string; kind: string; count: number; realized: number; pending: number; total: number }>();
  for (const entry of entries) {
    const category = entry.category || "Sem categoria";
    const key = JSON.stringify([entry.kind, entry.unit, category]);
    const row = rows.get(key) || { category, unit: entry.unit, kind: entry.kind, count: 0, realized: 0, pending: 0, total: 0 };
    const value = effectiveAmount(entry);
    row.count += 1;
    row.total += value;
    row[entry.status === "realizado" ? "realized" : "pending"] += value;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}

const sortedEntries = (entries: ExportEntry[]) =>
  [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description, "pt-BR"));

export async function exportFinanceExcel(options: FinanceExport) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinCore";
  workbook.created = new Date();
  const summary = summarizeEntries(options.entries);
  const overview = workbook.addWorksheet("Resumo");
  overview.columns = [{ width: 28 }, { width: 28 }];
  overview.addRow([options.title]);
  overview.addRow(["Filtros", options.filterDescription]);
  overview.addRow(["Lançamentos", options.entries.length]);
  overview.addRow([]);
  for (const [label, value] of [
    ["Receitas", summary.receitas], ["Recebido", summary.recebido],
    ["A receber", summary.aReceber], ["Despesas", summary.despesas],
    ["Pago", summary.pago], ["A pagar", summary.aPagar],
    ["Resultado projetado", summary.receitas - summary.despesas],
    ["Resultado realizado", summary.recebido - summary.pago],
  ] as const) {
    const row = overview.addRow([label, value]);
    row.getCell(2).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  }
  overview.getRow(1).font = { bold: true, size: 16, color: { argb: "FF14213D" } };
  overview.getColumn(1).font = { bold: true };

  if (options.includeCategories) {
    const categories = workbook.addWorksheet("Categorias");
    categories.columns = [
      { header: "Tipo", key: "kind", width: 14 },
      { header: "Centro", key: "unit", width: 22 },
      { header: "Categoria", key: "category", width: 32 },
      { header: "Lançamentos", key: "count", width: 15 },
      { header: "Realizado", key: "realized", width: 19 },
      { header: "Em aberto", key: "pending", width: 19 },
      { header: "Total", key: "total", width: 19 },
    ];
    for (const row of categoriesForExport(options.entries)) {
      categories.addRow({ ...row, kind: row.kind === "receita" ? "Receita" : "Despesa" });
    }
    styleTable(categories, ["realized", "pending", "total"]);
  }

  const detail = workbook.addWorksheet("Lançamentos");
  detail.columns = [
    { header: "Vencimento", key: "date", width: 17 },
    { header: "Tipo", key: "kind", width: 13 },
    { header: "Situação", key: "status", width: 15 },
    { header: "Centro", key: "unit", width: 22 },
    { header: "Conta", key: "account", width: 22 },
    { header: "Categoria", key: "category", width: 25 },
    { header: "Descrição", key: "description", width: 42 },
    { header: "Fornecedor / cliente", key: "beneficiary", width: 32 },
    { header: "Valor (R$)", key: "amount", width: 18 },
    { header: "Juros (R$)", key: "juros", width: 17 },
    { header: "Desconto (R$)", key: "discount", width: 18 },
    { header: "Total (R$)", key: "total", width: 18 },
    { header: "Pagamento / recebimento", key: "paidDate", width: 27 },
    { header: "Parcela", key: "installment", width: 16 },
    { header: "Recorrência", key: "recurrence", width: 17 },
    { header: "PIX / pagamento", key: "pix", width: 32 },
    { header: "Observações", key: "notes", width: 45 },
  ];
  for (const entry of sortedEntries(options.entries)) {
    const row = detail.addRow({
      date: excelDate(entry.date),
      kind: entry.kind === "receita" ? "Receita" : "Despesa",
      status: entry.status === "realizado" ? "Realizado" : "Previsto",
      unit: entry.unit, account: entry.account, category: entry.category,
      description: entry.description, beneficiary: entry.beneficiary || "",
      amount: entry.amount, juros: entry.juros || 0, discount: entry.discount || 0,
      total: effectiveAmount(entry), paidDate: excelDate(entry.paidDate),
      installment: entry.installment || "",
      recurrence: entry.recurrence === "mensal" ? "Mensal" : "Não",
      pix: entry.pix || "", notes: entry.notes || "",
    });
    row.getCell("date").numFmt = "dd/mm/yyyy";
    row.getCell("paidDate").numFmt = "dd/mm/yyyy";
  }
  styleTable(detail, ["amount", "juros", "discount", "total"]);
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName(options, "xlsx"));
  return workbook;
}

function styleTable(sheet: import("exceljs").Worksheet, currencyKeys: string[]) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14213D" } }; });
  for (const key of currencyKeys) sheet.getColumn(key).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
}

export async function exportFinancePdf(options: FinanceExport) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"), import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const summary = summarizeEntries(options.entries);
  doc.setFillColor(20, 33, 61);
  doc.rect(0, 0, 297, 27, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.text(`FinCore  |  ${options.title}`, 13, 17);
  doc.setTextColor(50, 62, 85);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const filterLines = doc.splitTextToSize(options.filterDescription, 270);
  doc.text(filterLines, 13, 35);
  const top = 38 + filterLines.length * 4;
  doc.text(`${options.entries.length} lançamentos`, 13, top);
  doc.text(`Receitas: ${brl(summary.receitas)}  |  Despesas: ${brl(summary.despesas)}  |  Resultado: ${brl(summary.receitas - summary.despesas)}`, 13, top + 6);
  doc.text(`Recebido: ${brl(summary.recebido)}  |  Pago: ${brl(summary.pago)}  |  A receber: ${brl(summary.aReceber)}  |  A pagar: ${brl(summary.aPagar)}`, 13, top + 12);
  let startY = top + 19;
  if (options.includeCategories) {
    doc.setFont("helvetica", "bold");
    doc.text("Categorias", 13, startY);
    autoTable(doc, {
      startY: startY + 3,
      head: [["Tipo", "Centro", "Categoria", "Qtd.", "Realizado", "Em aberto", "Total"]],
      body: categoriesForExport(options.entries).map((row) => [
        row.kind === "receita" ? "Receita" : "Despesa", row.unit, row.category,
        String(row.count), brl(row.realized), brl(row.pending), brl(row.total),
      ]),
      theme: "striped", styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 75, 178] }, margin: { left: 13, right: 13, bottom: 15 },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 32 }, 2: { cellWidth: 65 }, 3: { cellWidth: 18 }, 4: { cellWidth: 38 }, 5: { cellWidth: 38 }, 6: { cellWidth: 38 } },
    });
    startY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || startY;
    startY += 12;
    if (startY > 175) { doc.addPage(); startY = 18; }
  }
  doc.setFont("helvetica", "bold");
  doc.text("Lançamentos", 13, startY);
  autoTable(doc, {
    startY: startY + 3,
    head: [["Vencimento", "Tipo", "Situação", "Centro", "Categoria", "Descrição", "Fornecedor / cliente", "Valor", "Total"]],
    body: sortedEntries(options.entries).map((entry) => [
      displayDate(entry.date), entry.kind === "receita" ? "Receita" : "Despesa",
      entry.status === "realizado" ? "Realizado" : "Previsto",
      entry.unit, entry.category, entry.description, entry.beneficiary || "-",
      brl(entry.amount), brl(effectiveAmount(entry)),
    ]),
    theme: "striped", styles: { fontSize: 7, cellPadding: 1.8, overflow: "linebreak" },
    headStyles: { fillColor: [20, 33, 61] },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 17 }, 2: { cellWidth: 18 }, 3: { cellWidth: 25 }, 4: { cellWidth: 28 }, 5: { cellWidth: 49 }, 6: { cellWidth: 38 }, 7: { cellWidth: 30 }, 8: { cellWidth: 30 } },
    margin: { left: 13, right: 13, bottom: 15 },
  });
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(130, 140, 158);
    doc.text(`FinCore  |  ${page}/${doc.getNumberOfPages()}`, 284, 202, { align: "right" });
  }
  doc.save(fileName(options, "pdf"));
  return doc;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
