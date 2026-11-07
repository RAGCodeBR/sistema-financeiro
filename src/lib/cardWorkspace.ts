import type { CardRefund, CardStatement } from "./cardStatement";
import type { AppliedStatementItem, StatementImportEntry } from "./cardImport";

export type CardWorkspace = { version: 1; statements: CardStatement[]; entries: StatementImportEntry[]; applied: AppliedStatementItem[]; activeFingerprint: string; exampleDismissed?: boolean; refunds?: CardRefund[] };
export const emptyCardWorkspace = (): CardWorkspace => ({ version: 1, statements: [], entries: [], applied: [], activeFingerprint: "" });
const key = (scope: string) => `fincore.cards.workspace.v1.${scope}`;
export function readCardWorkspace(scope: string): CardWorkspace {
  try {
    const value = JSON.parse(localStorage.getItem(key(scope)) || "null");
    if (value?.version !== 1 || !Array.isArray(value.statements) || !Array.isArray(value.entries) || !Array.isArray(value.applied)) return emptyCardWorkspace();
    return { ...value, statements: value.statements.filter((s: CardStatement) => typeof s.fingerprint === "string" && Array.isArray(s.transactions) && Array.isArray(s.warnings)), entries: value.entries.filter((e: StatementImportEntry) => typeof e.id === "string" && typeof e.amount === "number"), refunds: Array.isArray(value.refunds) ? value.refunds.filter((r: CardRefund) => r && typeof r.sourceKey === "string" && Number.isSafeInteger(r.amountCents) && typeof r.date === "string" && typeof r.note === "string") : [], activeFingerprint: typeof value.activeFingerprint === "string" ? value.activeFingerprint : "" };
  } catch { return emptyCardWorkspace(); }
}
export function writeCardWorkspace(scope: string, workspace: CardWorkspace) {
  // Persist before updating React, so a failed write never pretends a local
  // financial import was committed. Entries and source ledger share one key.
  localStorage.setItem(key(scope), JSON.stringify(workspace));
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fincore-card-pdfs", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("files"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function cacheStatementFile(scope: string, fingerprint: string, file: File) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, `${scope}:${fingerprint}`);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function cachedStatementFile(scope: string, fingerprint: string): Promise<File | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("files").objectStore("files").get(`${scope}:${fingerprint}`);
      request.onsuccess = () => resolve(request.result instanceof Blob ? new File([request.result], request.result instanceof File ? request.result.name : "fatura.pdf", { type: "application/pdf" }) : null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function removeStatementFile(scope: string, fingerprint: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(`${scope}:${fingerprint}`);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
