export const statementFileAccept = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
export function validateStatementBatch(files: Pick<File, "size" | "name">[]) {
  if (!files.length) throw new Error("Selecione ou arraste um PDF ou imagem de fatura.");
  if (files.length > 10) throw new Error("Importe até 10 arquivos por vez.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error("Use até 100 MB por lote e até 25 MB por arquivo.");
}
