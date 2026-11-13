import { FiscalError, ISSUER_CNPJ } from "./model.ts";
export const HOMOLOGATION_SEFIN =
  "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional";
export const HOMOLOGATION_DANFSE =
  "https://adn.producaorestrita.nfse.gov.br/danfse";
export const HOMOLOGATION_PARAMETERS =
  "https://adn.producaorestrita.nfse.gov.br/parametrizacao";
export const HOMOLOGATION_CNC =
  "https://adn.producaorestrita.nfse.gov.br/cnc/consulta";
// Sefin advertises HTTP/2 but terminates mTLS requests with HTTP_1_1_REQUIRED.
// Pin HTTP/1.1 before connecting; never retry a POST to negotiate protocol.
export const nationalHttpClientOptions = (cert: string, key: string) => ({
  cert,
  key,
  http1: true,
  http2: false,
});
export async function limitedBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new FiscalError(
      "RESPONSE_LIMIT",
      "A resposta do serviço excedeu o limite seguro.",
      502,
    );
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new FiscalError(
          "RESPONSE_LIMIT",
          "A resposta do serviço excedeu o limite seguro.",
          502,
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function createNationalTransport(deps: {
  createClient: (cert: string, key: string) => any;
  fetch: (url: string, options: any) => Promise<Response>;
  gzip: (text: string) => string;
  gunzip: (base64: string) => string;
}) {
  return (cert: string, key: string) => {
    const client = deps.createClient(cert, key);
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      pdf = false,
    ) => {
      const parameter =
        /^\/parametros_municipais\/\d{7}\/(?:convenio|\d{2}\.\d{2}\.\d{2}\.\d{3}\/\d{4}-\d{2}-\d{2}T00:00:00\/aliquota)$/.test(
          path,
        );
      const cnc = path.match(new RegExp(`^/cnc/(\\d{7})/(${ISSUER_CNPJ})$`));
      if (
        !parameter &&
        !cnc &&
        !/^\/(dps\/DPS\d{42}|nfse(?:\/\d{50})?)$/.test(path) &&
        !pdf
      )
        throw new FiscalError(
          "INVALID_ROUTE",
          "Consulta nacional não permitida.",
        );
      if (pdf && !/^\/\d{50}$/.test(path))
        throw new FiscalError("INVALID_ROUTE", "Documento nacional inválido.");
      let response: Response;
      try {
        response = await deps.fetch(
          cnc
            ? `${HOMOLOGATION_CNC}/cad?codMunicipio=${cnc[1]}&inscricaoFederal=${cnc[2]}`
            : (pdf
                ? HOMOLOGATION_DANFSE
                : parameter
                  ? HOMOLOGATION_PARAMETERS
                  : HOMOLOGATION_SEFIN) +
                (parameter ? path.replace("/parametros_municipais", "") : path),
          {
            method,
            client,
            redirect: "error",
            signal: AbortSignal.timeout(25000),
            headers: {
              Accept: pdf ? "application/pdf" : "application/json",
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        );
      } catch {
        throw new FiscalError(
          "NATIONAL_UNAVAILABLE",
          "Não foi possível concluir a comunicação com o ambiente nacional de homologação. Consulte o resultado antes de repetir um envio.",
          503,
        );
      }
      const bytes = await limitedBytes(
        response,
        pdf ? 4 * 1024 * 1024 : 2 * 1024 * 1024,
      );
      if (pdf) {
        if (
          !response.ok ||
          String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
        )
          throw new FiscalError(
            "PDF_UNAVAILABLE",
            "O DANFSe de homologação ainda não está disponível no serviço nacional.",
            503,
          );
        return { status: response.status, pdf: bytes };
      }
      let data: any;
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new FiscalError(
          "NATIONAL_RESPONSE",
          "O emissor nacional retornou uma resposta não reconhecida. A operação deve ser consultada antes de repetir.",
          502,
        );
      }
      return { status: response.status, data };
    };
    return {
      query: (path: string) => call("GET", path),
      submit: (xml: string) => {
        if (!/<tpAmb>2<\/tpAmb>/.test(xml) || /<tpAmb>1<\/tpAmb>/.test(xml))
          throw new FiscalError(
            "PRODUCTION_DISABLED",
            "Emissão em produção desabilitada.",
            403,
          );
        return call("POST", "/nfse", { dpsXmlGZipB64: deps.gzip(xml) });
      },
      pdf: (key: string) => call("GET", "/" + key, undefined, true),
      unpack: (data: any) => {
        const packed = data?.nfseXmlGZipB64;
        if (typeof packed !== "string" || packed.length > 2 * 1024 * 1024)
          throw new FiscalError(
            "NATIONAL_RESPONSE",
            "O emissor não retornou o XML autorizado.",
            502,
          );
        let xml: string;
        try {
          xml = deps.gunzip(packed);
        } catch {
          throw new FiscalError(
            "NATIONAL_RESPONSE",
            "Não foi possível validar o XML retornado pelo emissor.",
            502,
          );
        }
        if (xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
          throw new FiscalError(
            "NATIONAL_RESPONSE",
            "XML retornado fora dos limites seguros.",
            502,
          );
        return xml;
      },
      close: () => client.close(),
    };
  };
}
export function nationalErrors(data: any): { code: string; message: string }[] {
  const list = Array.isArray(data?.erros)
    ? data.erros
    : Array.isArray(data?.errors)
      ? data.errors
      : data?.erro && typeof data.erro === "object"
        ? [data.erro]
        : [];
  return list.slice(0, 20).map((error: any) => ({
    code: String(
      error.Codigo || error.codigo || error.code || "REJEICAO",
    ).slice(0, 50),
    message: String(
      error.Descricao ||
        error.descricao ||
        error.message ||
        "Confira os dados informados.",
    )
      .replace(/<[^>]*>/g, "")
      .slice(0, 1000),
  }));
}
export function dpsNotFound(result: any): boolean {
  return (
    result?.status === 404 &&
    result?.data?.tipoAmbiente !== 1 &&
    !result?.data?.chaveAcesso &&
    nationalErrors(result?.data).some((error) => error.code === "E2404")
  );
}
export function nationalEligibility(data: any): boolean | null {
  if (!data || typeof data !== "object") return null;
  for (const [key, value] of Object.entries(data)) {
    if (key.toLowerCase() === "aderenteemissornacional")
      return value === true || value === 1 || value === "1" || value === "true"
        ? true
        : value === false || value === 0 || value === "0" || value === "false"
          ? false
          : null;
    if (value && typeof value === "object") {
      const found = nationalEligibility(value);
      if (found !== null) return found;
    }
  }
  return null;
}
