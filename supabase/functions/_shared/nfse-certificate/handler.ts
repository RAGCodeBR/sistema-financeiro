import { CertificateError, encryptionKey, sealCertificate } from "./crypto.ts";
import { MAX_CERTIFICATE_BYTES, validateCertificate } from "./validate.ts";

type Actor = {
  id: string;
  role: string;
  allowedUnits: string[];
  hiddenScreens: string[];
};
type Configuration = {
  issuerCnpj: string;
  rootsPem: string;
  keyId: string;
  keys: Record<string, string>;
  origins: string[];
};
export type CertificateDependencies = {
  config: Configuration;
  forge: any;
  authenticate: (token: string) => Promise<Actor | null>;
  rpc: (name: string, params: Record<string, unknown>) => Promise<any>;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const MAX_BODY = MAX_CERTIFICATE_BYTES + 16384;

async function boundedBody(request: Request): Promise<Uint8Array> {
  const claimed = request.headers.get("content-length");
  if (
    claimed !== null &&
    (!/^\d+$/.test(claimed) || Number(claimed) > MAX_BODY)
  )
    throw new CertificateError(
      "FILE_SIZE",
      "O envio ultrapassa o limite de 512 KB para o certificado.",
      413,
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new CertificateError(
      "INVALID_REQUEST",
      "Selecione o arquivo do certificado.",
      400,
    );
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY) {
        await reader.cancel();
        throw new CertificateError(
          "FILE_SIZE",
          "O envio ultrapassa o limite de 512 KB para o certificado.",
          413,
        );
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return body;
  } finally {
    reader.releaseLock();
  }
}

export function createCertificateHandler(deps: CertificateDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = deps.config.origins.includes(origin);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(allowedOrigin
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers":
              "authorization, apikey, content-type, x-client-info",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          }
        : {}),
    };
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (!allowedOrigin)
      return reply(
        {
          code: "ORIGIN_DENIED",
          error: "Origem não autorizada para o certificado.",
        },
        403,
      );
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (!["GET", "POST", "DELETE"].includes(request.method))
      return reply(
        { code: "METHOD_NOT_ALLOWED", error: "Operação não permitida." },
        405,
      );
    let actor: Actor | null = null;
    let attempted = false;
    let fileBytes: Uint8Array | null = null;
    let bodyBytes: Uint8Array | null = null;
    let password = "";
    const { issuerCnpj, rootsPem, keyId, keys } = deps.config;
    const params = () => ({ p_actor_id: actor!.id, p_issuer_cnpj: issuerCnpj });
    try {
      const authorization = request.headers.get("authorization") || "";
      if (!/^Bearer [^\s]+$/i.test(authorization))
        throw new CertificateError(
          "UNAUTHENTICATED",
          "Entre novamente no sistema para acessar o certificado.",
          401,
        );
      actor = await deps.authenticate(authorization.slice(7));
      if (!actor)
        throw new CertificateError(
          "UNAUTHENTICATED",
          "Sua sessão expirou. Entre novamente no sistema.",
          401,
        );
      const master = actor.role === "master";
      const reader =
        master ||
        (actor.allowedUnits.includes("__income_write__") &&
          !actor.hiddenScreens.includes("nfse"));
      if (!reader || (request.method !== "GET" && !master))
        throw new CertificateError(
          "FORBIDDEN",
          "Somente um usuário Master pode cadastrar, substituir ou remover o A1.",
          403,
        );
      if (!/^\d{14}$/.test(issuerCnpj))
        throw new CertificateError(
          "NOT_CONFIGURED",
          "O emissor ainda não está configurado no servidor.",
          503,
        );
      let configured = false;
      try {
        const key = encryptionKey(keys, keyId);
        key.fill(0);
        configured = rootsPem.includes("-----BEGIN CERTIFICATE-----");
      } catch {
        /* fail closed below */
      }
      const current = await deps.rpc("nfse_certificate_status", params());
      if (request.method === "GET")
        return reply({
          configured,
          issuerCnpj,
          canManage: master,
          certificate: current,
          fiscalReady: false,
          ...(!configured
            ? {
                message:
                  "O servidor precisa da chave de criptografia e das raízes ICP-Brasil para liberar o envio.",
              }
            : {}),
        });
      if (!configured)
        throw new CertificateError(
          "NOT_CONFIGURED",
          "O armazenamento seguro e a confiança ICP-Brasil precisam ser ativados no servidor antes do envio.",
          503,
        );
      if (!(await deps.rpc("nfse_certificate_attempt", params())))
        throw new CertificateError(
          "RATE_LIMIT",
          "Limite de tentativas atingido. Aguarde 10 minutos e tente novamente.",
          429,
        );
      attempted = true;
      if (request.method === "DELETE") {
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          throw new CertificateError(
            "INVALID_REQUEST",
            "Solicitação de remoção inválida.",
            400,
          );
        bodyBytes = await boundedBody(request);
        let payload: any;
        try {
          payload = JSON.parse(new TextDecoder().decode(bodyBytes));
        } catch {
          throw new CertificateError(
            "INVALID_REQUEST",
            "Solicitação de remoção inválida.",
            400,
          );
        }
        if (!uuid(payload?.expectedId) || Object.keys(payload).length !== 1)
          throw new CertificateError(
            "INVALID_REQUEST",
            "Atualize a tela antes de remover o certificado.",
            400,
          );
        await deps.rpc("nfse_certificate_remove", {
          ...params(),
          p_expected_id: payload.expectedId,
        });
        return reply({ removed: true });
      }
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.startsWith("multipart/form-data;"))
        throw new CertificateError(
          "INVALID_REQUEST",
          "Envie o arquivo A1 pelo formulário de certificado.",
          400,
        );
      bodyBytes = await boundedBody(request);
      let form: FormData;
      try {
        form = await new Response(bodyBytes as BodyInit, {
          headers: { "Content-Type": contentType },
        }).formData();
      } catch {
        throw new CertificateError(
          "INVALID_REQUEST",
          "Não foi possível ler o envio do certificado.",
          400,
        );
      }
      const file = form.get("file"),
        suppliedPassword = form.get("password"),
        expectedId = form.get("expectedId");
      if (
        form.getAll("file").length !== 1 ||
        form.getAll("password").length !== 1 ||
        form.getAll("expectedId").length > 1 ||
        [...form.keys()].some(
          (key) => !["file", "password", "expectedId"].includes(key),
        ) ||
        !(file instanceof File) ||
        typeof suppliedPassword !== "string"
      )
        throw new CertificateError(
          "INVALID_REQUEST",
          "Informe um arquivo A1 e sua senha.",
          400,
        );
      if (!/\.(pfx|p12)$/i.test(file.name))
        throw new CertificateError(
          "FILE_TYPE",
          "Selecione um arquivo de certificado A1 .pfx ou .p12.",
        );
      if (expectedId !== null && !uuid(expectedId))
        throw new CertificateError(
          "INVALID_REQUEST",
          "Atualize a tela antes de substituir o certificado.",
          400,
        );
      if ((current?.id || null) !== expectedId)
        throw new CertificateError(
          "CONFLICT",
          "O certificado foi alterado por outro usuário. Atualize a tela antes de continuar.",
          409,
        );
      if (file.size > MAX_CERTIFICATE_BYTES)
        throw new CertificateError(
          "FILE_SIZE",
          "Envie um A1 de até 512 KB.",
          413,
        );
      password = suppliedPassword;
      // Remove references from the multipart representation as early as possible.
      form.delete("password");
      form.delete("file");
      fileBytes = new Uint8Array(await file.arrayBuffer());
      const result = validateCertificate(
        deps.forge,
        fileBytes,
        password,
        issuerCnpj,
        rootsPem,
      );
      password = "";
      const id = crypto.randomUUID(),
        rawKey = encryptionKey(keys, keyId);
      let envelope;
      try {
        envelope = await sealCertificate(
          result.secret,
          issuerCnpj,
          id,
          keyId,
          rawKey,
        );
      } finally {
        rawKey.fill(0);
        result.secret.privateKeyPem = "";
        result.secret.certificatePem = "";
        result.secret.chainPem = [];
      }
      await deps.rpc("nfse_certificate_save", {
        ...params(),
        p_id: id,
        p_metadata: result.metadata,
        p_envelope: envelope,
        p_expected_id: expectedId,
      });
      return reply(
        {
          certificate: await deps.rpc("nfse_certificate_status", params()),
          fiscalReady: false,
        },
        201,
      );
    } catch (error) {
      const failure =
        error instanceof CertificateError
          ? error
          : new CertificateError(
              "SERVICE_UNAVAILABLE",
              "Não foi possível concluir a operação do certificado. Tente novamente ou contate o administrador.",
              503,
            );
      if (attempted && actor && request.method === "POST") {
        try {
          await deps.rpc("nfse_certificate_rejected", {
            ...params(),
            p_reason_code: failure.code,
          });
        } catch {
          /* Never log requests, passwords, keys or parser errors. */
        }
      }
      return reply(
        { code: failure.code, error: failure.message },
        failure.status,
      );
    } finally {
      password = "";
      fileBytes?.fill(0);
      bodyBytes?.fill(0);
    }
  };
}
