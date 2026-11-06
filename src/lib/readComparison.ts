import type { ComparisonEntry } from "./cardStatement";
import { normalizeStatementText } from "./cardStatement";

// Reads the existing FinCore Excel export; no banking credentials or remote I/O.
export async function readComparisonExcel(file: File): Promise<ComparisonEntry[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error("A planilha deve ter até 25 MB.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const result: ComparisonEntry[] = [];
  for (const sheet of workbook.worksheets) {
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, number) => headers.set(normalizeStatementText(cell.text), number));
    if (!headers.has("data") && headers.has("vencimento")) headers.set("data", headers.get("vencimento")!);
    if (!headers.has("centro de custo") && headers.has("centro")) headers.set("centro de custo", headers.get("centro")!);
    if (!headers.has("descricao") || !headers.has("valor r") || !headers.has("data")) continue;
    function date(value: unknown): string {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const text = String(value || "").trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
      const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
    }
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const cell = (header: string) => headers.has(header) ? row.getCell(headers.get(header)!) : null;
      const amount = cell("valor r")?.value;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return;
      const entryDate = date(cell("data")?.value);
      if (!entryDate) return;
      const description = cell("descricao")?.text || "";
      if (!description) return;
      result.push({ id: `excel-${sheet.id}-${index}`, description, amount, date: entryDate,
        kind: normalizeStatementText(cell("tipo")?.text || "despesa"),
        beneficiary: cell("fornecedor cliente")?.text || "", unit: cell("centro de custo")?.text || "",
        category: cell("categoria")?.text || "", installment: cell("parcela")?.text || "",
        paidDate: date(cell("pagamento recebimento")?.value),
        status: normalizeStatementText(cell("situacao")?.text || "") === "realizado" ? "realizado" : normalizeStatementText(cell("situacao")?.text || "") === "previsto" ? "previsto" : undefined,
      });
    });
  }
  if (!result.length) throw new Error("Nenhum lançamento válido encontrado. Use o Excel exportado pelo FinCore, com Vencimento (ou Data), Descrição e Valor (R$). Exporte todo o período relevante para uma comparação completa.");
  return result;
}
