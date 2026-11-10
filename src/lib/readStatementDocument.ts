import { normalizeStatementText, parseItauStatement, pdfLines, type CardStatement, type PdfPage } from "./cardStatement";
import { identifyStatement } from "./cardImport";
import { genericStatement } from "./genericStatement";
import { abortableReading, checkReadingAbort, statementOcr, type ReadingProgress } from "./statementOcr";

export type StatementDocument = { statement: CardStatement; requiresReview: boolean; extractedText: string; observations: string[]; blockingReason?: string; sourceType: "pdf" | "image" };
type ReadOptions = { signal?: AbortSignal; onProgress?: ReadingProgress; cachedStatements?: CardStatement[] };
export async function readStatementDocument(file: File, options: ReadOptions = {}): Promise<StatementDocument> {
  const { signal, onProgress } = options;
  if (file.size > 25 * 1024 * 1024) throw new Error("Envie um PDF ou imagem de até 25 MB.");
  const bytes = await file.arrayBuffer(), header = new Uint8Array(bytes.slice(0, 16));
  checkReadingAbort(signal);
  const pdf = new TextDecoder().decode(header.slice(0, 5)) === "%PDF-";
  const image = (header[0] === 137 && new TextDecoder().decode(header.slice(1, 4)) === "PNG") || (header[0] === 255 && header[1] === 216 && header[2] === 255) || (new TextDecoder().decode(header.slice(0, 4)) === "RIFF" && new TextDecoder().decode(header.slice(8, 12)) === "WEBP");
  if (!pdf && !image) throw new Error("Formato não suportado. Envie PDF, PNG, JPG ou WebP. Para fotos HEIC, exporte uma cópia em JPG.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  const cached = options.cachedStatements?.find(s => s.fingerprint === fingerprint);
  if (cached) return { statement: cached, requiresReview: false, extractedText: "", observations: [], sourceType: pdf ? "pdf" : "image" };
  const pages: PdfPage[] = [];
  let usedOcr = false, ocrPages = 0, ocr: Awaited<ReturnType<typeof statementOcr>> | undefined;
  async function recognize(canvas: HTMLCanvasElement, page: number) {
    usedOcr = true;
    if (++ocrPages > 20) throw new Error("Use até 20 páginas digitalizadas por arquivo. Divida documentos maiores antes de importar.");
    if (!ocr) ocr = await statementOcr(onProgress, signal);
    return ocr.read(canvas, page);
  }
  try {
    if (image) {
      onProgress?.({ message: "Abrindo imagem…" });
      const decoding = createImageBitmap(file).then(bitmap => { if (signal?.aborted) { bitmap.close(); checkReadingAbort(signal); } return bitmap; }, () => { throw new Error("Não foi possível abrir esta imagem. Exporte uma cópia legível em PNG, JPG ou WebP e tente novamente."); });
      const bitmap = await abortableReading(decoding, signal);
      try {
        if (bitmap.width * bitmap.height > 40_000_000) throw new Error("A imagem é muito grande. Reduza para até 40 megapixels.");
        const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d"); if (!context) throw new Error("Não foi possível abrir a imagem neste navegador.");
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        pages.push(await recognize(canvas, 1)); canvas.width = canvas.height = 0;
      } finally { bitmap.close(); }
    } else {
      const pdfjs = await import("pdfjs-dist");
      const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
      try {
        const doc = await abortableReading(task.promise, signal);
        if (doc.numPages > 100) throw new Error("Envie uma fatura com até 100 páginas.");
        for (let number = 1; number <= doc.numPages; number++) {
          checkReadingAbort(signal); onProgress?.({ message: `Lendo página ${number} de ${doc.numPages}…` });
          const page = await doc.getPage(number), content = await page.getTextContent();
          const tokens = content.items.filter((i): i is import("pdfjs-dist/types/src/display/api").TextItem => "str" in i).map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5] }));
          if (tokens.map(t => t.text).join("").replace(/\s/g, "").length >= 30) pages.push({ page: number, tokens });
          else {
            const initial = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(3, 2200 / Math.max(initial.width, initial.height)) });
            const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await abortableReading(page.render({ canvas, viewport }).promise, signal);
            pages.push(await recognize(canvas, number)); canvas.width = canvas.height = 0;
          }
          page.cleanup();
        }
      } catch (error) {
        if (error instanceof Error && error.name === "PasswordException") throw new Error("Este PDF está protegido por senha. Exporte uma cópia desbloqueada para a leitura local.");
        if (error instanceof Error && error.name === "InvalidPDFException") throw new Error("Não foi possível abrir este PDF. Exporte novamente a fatura e tente importar a nova cópia.");
        throw error;
      } finally { await task.destroy(); }
    }
    checkReadingAbort(signal);
    const extractedText = pages.map(p => `Página ${p.page}\n${pdfLines(p.tokens).map(l => l.text).join("\n")}`).join("\n\n");
    const maskedCards = new Set(pages.flatMap(p => p.tokens.flatMap(t => [...t.text.matchAll(/\d{4}[.\s*-]+(?:X{4}|\*{4})[.\s*-]+(?:X{4}|\*{4})[.\s*-]+\d{4}/gi)].map(m => m[0].replace(/[^\dX*]/gi, "").replace(/\*/g, "X").toUpperCase()))));
    const blockingReason = maskedCards.size > 1 ? "Este documento reúne mais de um cartão. Envie uma fatura separada por cartão para conferir e criar lançamentos." : undefined;
    const itau = pages.some(p => p.tokens.some(t => /\bitau\b/.test(normalizeStatementText(t.text))));
    let parsed: CardStatement | undefined;
    if (itau && !usedOcr) { try { parsed = parseItauStatement(pages, file.name, fingerprint); } catch { /* Unrecognized layouts continue through assisted review. */ } }
    const requiresReview = !parsed || usedOcr || Boolean(parsed.warnings.length) || Boolean(blockingReason);
    parsed ||= genericStatement(pages, file.name, fingerprint);
    parsed.readingMethod = usedOcr ? "ocr" : requiresReview ? "assisted" : "validated";
    parsed.sourceType = pdf ? "pdf" : "image";
    return { statement: requiresReview ? parsed : identifyStatement(parsed), requiresReview, extractedText, blockingReason, sourceType: pdf ? "pdf" : "image", observations: [...parsed.warnings, ...(usedOcr ? ["Texto reconhecido por imagem. Confira números, datas, parcelas e todas as páginas com o original."] : requiresReview ? ["Este modelo ainda não tem leitor específico validado. Confira todos os dados extraídos antes de importar."] : [])] };
  } finally { await ocr?.close(); }
}
