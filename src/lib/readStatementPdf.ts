import { normalizeStatementText, parseItauStatement, type CardStatement, type PdfPage } from "./cardStatement";
import { identifyStatement } from "./cardImport";

export async function readStatementPdf(file: File): Promise<CardStatement> {
  if (file.size > 25 * 1024 * 1024) throw new Error("Envie um PDF de até 25 MB.");
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("O arquivo não é um PDF válido.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > 100) throw new Error("Envie uma fatura com até 100 páginas.");
    const pages: PdfPage[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number), content = await page.getTextContent();
      pages.push({ page: number, tokens: content.items.filter((i): i is import("pdfjs-dist/types/src/display/api").TextItem => "str" in i).map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5] })) });
    }
    if (!pages.some(page => page.tokens.some(token => /\bitau\b/.test(normalizeStatementText(token.text))))) throw new Error("O banco ou layout deste PDF ainda não foi validado. A leitura automática atual é específica para a fatura Itaú enviada.");
    const parsed = parseItauStatement(pages, file.name, fingerprint);
    const maskedCards = new Set(pages.flatMap(page => page.tokens.flatMap(token => [...token.text.matchAll(/\d{4}[.\s*-]+(?:X{4}|\*{4})[.\s*-]+(?:X{4}|\*{4})[.\s*-]+\d{4}/gi)].map(match => match[0].replace(/[^\dX*]/gi, "").replace(/\*/g, "X").toUpperCase()))));
    if (maskedCards.size > 1) parsed.warnings.push("O PDF apresenta mais de um cartão. A separação desse layout precisa ser validada antes de criar lançamentos.");
    return identifyStatement(parsed);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new Error("Este PDF está protegido por senha. Exporte uma cópia desbloqueada para a leitura local.");
    throw error;
  } finally { await task.destroy(); }
}
