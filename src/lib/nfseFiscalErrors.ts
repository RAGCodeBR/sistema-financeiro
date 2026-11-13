// Only messages deliberately returned by our fiscal handler are shown verbatim.
// Gateway/runtime codes must not be mistaken for a missing deployment.
export function nfseFiscalError(result: unknown, status: number): string {
  const data =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
  if (data.code === "WORKER_LIMIT" || status === 546)
    return "A consulta foi interrompida pelo limite de processamento do servidor. Atualize o histórico antes de repetir um envio; se persistir, contate o suporte.";
  if (data.code === "BOOT_ERROR")
    return "O serviço fiscal não conseguiu iniciar. Contate o suporte para verificar a função no servidor.";
  if (typeof data.error === "string" && data.error.trim())
    return data.error.slice(0, 2000);
  if (status === 401)
    return "Sua sessão não foi aceita pelo serviço fiscal. Entre novamente no sistema.";
  if (status === 403)
    return "O serviço fiscal recusou o acesso. Confira as permissões da sua conta.";
  if (status === 404)
    return "O serviço de homologação não foi encontrado no servidor. Contate o suporte para conferir a publicação.";
  return `O serviço de homologação não concluiu a operação (HTTP ${status}). Atualize o histórico antes de repetir um envio.`;
}
