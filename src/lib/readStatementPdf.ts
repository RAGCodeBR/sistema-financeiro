import type { CardStatement } from "./cardStatement";
import { readStatementDocument } from "./readStatementDocument";

// Compatibility for callers that explicitly require a validated statement.
// The UI uses readStatementDocument and presents assisted review when needed.
export async function readStatementPdf(file: File): Promise<CardStatement> {
  const result = await readStatementDocument(file);
  if (result.requiresReview) throw new Error("Este documento precisa da etapa de leitura assistida antes de importar.");
  return result.statement;
}
