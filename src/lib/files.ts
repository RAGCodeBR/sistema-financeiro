/**
 * Copia o arquivo para a memória no momento em que ele é anexado.
 *
 * No Windows, o envio pode falhar com "Failed to fetch" quando o navegador não
 * consegue reler o arquivo no disco na hora do upload (arquivo do OneDrive
 * ainda não baixado, aberto/travado em outro programa, alterado depois de
 * anexado ou arrastado de dentro de um .zip — ERR_UPLOAD_FILE_CHANGED no
 * Chrome). Com a cópia em memória, o upload não depende mais do arquivo
 * original, e um problema de leitura aparece logo ao anexar.
 */
export async function snapshotFile(file: File): Promise<File> {
  const buffer = await file.arrayBuffer();
  return new File([buffer], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

export const unreadableFileMessage = (name: string) =>
  `Não foi possível ler "${name}". Se ele estiver no OneDrive/Google Drive, aberto em outro programa ou dentro de um .zip, salve uma cópia numa pasta comum (ex.: Downloads) e anexe de novo.`;

/** Erro de rede do navegador (a requisição nem recebeu resposta). */
export const isNetworkFailure = (message: string | undefined) =>
  /failed to fetch|networkerror|network request failed|load failed/i.test(message ?? "");

export const networkUploadMessage =
  "Falha de conexão ao enviar o arquivo (o servidor não recebeu nada). Verifique a internet e tente de novo; se continuar, recarregue a página (F5).";
