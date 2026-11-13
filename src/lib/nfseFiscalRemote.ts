import { supabase, supabasePublishableKey, supabaseUrl } from "./supabase";
import type { NfseWorkspace, NfseDraft } from "./nfseDrafts";
import { nfseFiscalError } from "./nfseFiscalErrors";
export type NfseEmission = {
  id: string;
  draftId: string;
  draftRevision: number;
  status: string;
  dpsId: string;
  number: string;
  series: number;
  environment: 2;
  accessKey: string | null;
  errors: { code: string; message: string }[];
  createdAt: string;
  updatedAt: string;
};
export type NfseFiscalState = {
  config: Omit<NfseWorkspace, "version" | "drafts">;
  configRevision: number;
  drafts: { payload: NfseDraft; revision: number }[];
  emissions: NfseEmission[];
  connection: null | {
    revocationStatus: string;
    checkedAt: string;
    validUntil: string | null;
    eligible: boolean | null;
    details: {
      connected?: boolean;
      municipalityCode?: string;
      serviceStatus?: number;
      cnc?: {
        municipalRegistration: string | null;
        municipalityCode: string;
        checkedAt: string;
        source: "cnc";
      };
      warning?: string;
    };
  };
  canConfigure: boolean;
  canIssue: boolean;
  environment: 2;
  productionEnabled: false;
};
export type NfseFiscalService = {
  load: () => Promise<NfseFiscalState>;
  execute: (data: Record<string, unknown>) => Promise<NfseFiscalState>;
  download: (
    id: string,
    format: "xml" | "pdf",
  ) => Promise<{ blob: Blob; filename: string }>;
};
async function request(data?: Record<string, unknown>) {
  const endpoint = new URL(
    import.meta.env.DEV
      ? "http://127.0.0.1:8789/nfse-fiscal"
      : "functions/v1/nfse-fiscal",
    supabaseUrl.replace(/\/$/, "") + "/",
  );
  if (
    endpoint.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(endpoint.hostname)
  )
    throw new Error("O serviço fiscal exige HTTPS.");
  const initial = await supabase.auth.getSession();
  let session = initial.data.session;
  if (initial.error || !session)
    throw new Error("Entre novamente no sistema para acessar a NFS-e.");
  if ((session.expires_at || 0) * 1000 < Date.now() + 60000) {
    const next = await supabase.auth.refreshSession();
    if (next.error || !next.data.session)
      throw new Error("Sua sessão expirou.");
    session = next.data.session;
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: data ? "POST" : "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(110000),
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${session.access_token}`,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify({ ...data, environment: 2 }) } : {}),
    });
  } catch {
    throw new Error(
      "Não foi possível concluir a comunicação. Atualize o histórico e consulte a DPS antes de repetir um envio.",
    );
  }
  if (
    response.ok &&
    response.headers.get("content-type")?.includes("application/pdf")
  )
    return response;
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "O serviço fiscal retornou uma resposta não reconhecida. Atualize o histórico.",
    );
  }
  if (!response.ok) throw new Error(nfseFiscalError(result, response.status));
  return result;
}
function state(value: any): NfseFiscalState {
  if (
    value?.environment !== 2 ||
    value?.productionEnabled !== false ||
    !Array.isArray(value.drafts) ||
    !Array.isArray(value.emissions) ||
    !value.config ||
    !Number.isSafeInteger(value.configRevision)
  )
    throw new Error(
      "Status fiscal inválido. A transmissão permanece bloqueada.",
    );
  return value;
}
export const remoteNfseFiscalService: NfseFiscalService = {
  load: async () => state(await request()),
  execute: async (data) => state(await request(data)),
  download: async (id, format) => {
    const result = await request({ action: format, id });
    if (format === "pdf" && result instanceof Response)
      return { blob: await result.blob(), filename: `HOMOLOGACAO-${id}.pdf` };
    if (format === "xml" && typeof result?.xml === "string")
      return {
        blob: new Blob([result.xml], { type: "application/xml;charset=utf-8" }),
        filename: `HOMOLOGACAO-${id}.xml`,
      };
    throw new Error("O documento ainda não está disponível.");
  },
};
