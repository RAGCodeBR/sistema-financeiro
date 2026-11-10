import type { Worker } from "tesseract.js";
import type { PdfPage } from "./cardStatement";
export type ReadingProgress = (progress: { message: string; percent?: number }) => void;
export function checkReadingAbort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Leitura cancelada.", "AbortError"); }
export function abortableReading<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  checkReadingAbort(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException("Leitura cancelada.", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}
export async function statementOcr(onProgress?: ReadingProgress, signal?: AbortSignal) {
  const { createWorker, OEM } = await import("tesseract.js");
  checkReadingAbort(signal);
  const root = new URL("ocr/", new URL(import.meta.env.BASE_URL, document.baseURI)).href;
  onProgress?.({ message: "Preparando leitura de imagens…" });
  const languageResponse = await fetch(`${root}por.traineddata.gz`, { signal });
  if (!languageResponse.ok) throw new Error("Não foi possível carregar a leitura de imagens. Atualize a página e tente novamente.");
  await languageResponse.arrayBuffer();
  checkReadingAbort(signal);
  let worker: Worker | undefined;
  let activePage = 1;
  let failStartup: (error: Error) => void = () => {};
  const startupFailure = new Promise<never>((_, reject) => { failStartup = reject; });
  const starting = createWorker("por", OEM.LSTM_ONLY, {
    workerPath: `${root}worker.min.js`, corePath: root, langPath: root.replace(/\/$/, ""), workerBlobURL: false,
    cachePath: "fincore-ocr-por-v1", logger: progress => onProgress?.({ message: progress.status === "recognizing text" ? `Reconhecendo texto da página ${activePage}…` : "Preparando leitura de imagens…", percent: Math.round(progress.progress * 100) }),
    errorHandler: () => failStartup(new Error("Não foi possível iniciar a leitura de imagens. Atualize a página e tente novamente.")),
  }).then(value => { if (signal?.aborted) { void value.terminate(); checkReadingAbort(signal); } worker = value; return value; });
  await abortableReading(Promise.race([starting, startupFailure]), signal);
  try { await worker!.setParameters({ preserve_interword_spaces: "1" }); }
  catch (error) { await worker?.terminate(); throw error; }
  return {
    async read(canvas: HTMLCanvasElement, page: number): Promise<PdfPage> {
      activePage = page;
      const result = await abortableReading(worker!.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true }), signal);
      checkReadingAbort(signal);
      const lines = result.data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)) || [];
      const tokens = lines.map(line => ({ text: line.text.trim(), x: line.bbox.x0, y: canvas.height - (line.bbox.y0 + line.bbox.y1) / 2 }));
      return { page, tokens: tokens.length ? tokens : result.data.text.split(/\r?\n/).map((text, index) => ({ text, x: 0, y: canvas.height - index * 20 })) };
    },
    async close() { await worker?.terminate(); worker = undefined; },
  };
}
