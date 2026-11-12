import { supabase, supabasePublishableKey, supabaseUrl } from "./supabase";
import type { NfseCertificateService } from "./nfseCertificate";

async function request(
  method: string,
  body?: FormData | string,
  signal?: AbortSignal,
) {
  const endpoint = new URL(
    "functions/v1/nfse-certificate",
    `${supabaseUrl.replace(/\/$/, "")}/`,
  );
  if (
    endpoint.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
  )
    throw new Error("O envio do certificado exige uma conexão HTTPS.");
  const {
    data: { session: initial },
    error,
  } = await supabase.auth.getSession();
  if (error || !initial)
    throw new Error("Entre novamente no sistema para acessar o certificado.");
  let session = initial;
  if ((session.expires_at || 0) * 1000 < Date.now() + 60000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session)
      throw new Error("Sua sessão expirou. Entre novamente no sistema.");
    session = refreshed.data.session;
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${session.access_token}`,
        ...(typeof body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body ? { body } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      "Não foi possível conectar ao serviço do A1. Verifique se a função segura foi ativada no Supabase. Se um envio foi interrompido, atualize o status antes de tentar novamente.",
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "O serviço do A1 retornou uma resposta inválida. Atualize o status antes de tentar novamente.",
    );
  }
  if (!response.ok) {
    if (response.status === 404)
      throw new Error(
        "O serviço seguro do A1 ainda não foi ativado no servidor.",
      );
    if (response.status === 401)
      throw new Error(
        "Sua sessão não foi aceita pelo serviço do A1. Entre novamente no sistema.",
      );
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "O serviço do certificado está indisponível ou ainda não foi ativado.",
    );
  }
  return data;
}

export const remoteNfseCertificateService: NfseCertificateService = {
  status: async (signal) => {
    const result = await request("GET", undefined, signal);
    if (
      typeof result.configured !== "boolean" ||
      typeof result.canManage !== "boolean" ||
      !/^\d{14}$/.test(result.issuerCnpj) ||
      result.fiscalReady !== false
    )
      throw new Error("O serviço do certificado retornou um status inválido.");
    return result;
  },
  upload: async (file, password, expectedId, signal) => {
    const form = new FormData();
    form.set("file", file);
    form.set("password", password);
    if (expectedId) form.set("expectedId", expectedId);
    try {
      await request("POST", form, signal);
    } finally {
      form.delete("file");
      form.delete("password");
    }
  },
  remove: async (expectedId) => {
    await request("DELETE", JSON.stringify({ expectedId }));
  },
};
