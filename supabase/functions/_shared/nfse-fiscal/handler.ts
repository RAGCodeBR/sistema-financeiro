import {
  FiscalError,
  ISSUER_CNPJ,
  cleanConfig,
  cleanDraft,
  draftIssues,
  buildDps,
  isUuid,
  digits,
  todayInBrazil,
} from "./model.ts";
import { openCertificate } from "../nfse-certificate/crypto.ts";
import {
  resolveIssuerRegistration,
  assertDpsIssuerRegistration,
  type IssuerRegistrationDecision,
} from "./issuer.ts";
import {
  nationalErrors,
  nationalEligibility,
  limitedBytes,
  dpsNotFound,
} from "./transport.ts";

type Actor = {
  id: string;
  role: string;
  allowedUnits: string[];
  hiddenScreens: string[];
};
export type FiscalDependencies = {
  origins: string[];
  keys: Record<string, string>;
  rootsPem: string;
  authenticate: (token: string) => Promise<Actor | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<any>;
  revocation: (cert: string, chain: string[], roots: string) => Promise<any>;
  transport: (cert: string, key: string) => any;
  sign: (xml: string, key: string, cert: string) => string;
  verifyResult: (xml: string, record: any, key: string) => void;
  transmissionAvailable?: boolean;
};
export function createFiscalHandler(deps: FiscalDependencies) {
  return async (request: Request) => {
    const origin = request.headers.get("origin") || "",
      allowed = deps.origins.includes(origin);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      Vary: "Origin",
      ...(allowed
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers":
              "authorization, apikey, content-type, x-client-info",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          }
        : {}),
    };
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    if (!allowed)
      return reply(
        { error: "Origem não autorizada.", code: "ORIGIN_DENIED" },
        403,
      );
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Operação não permitida." }, 405);
    let secret: Record<string, unknown> | undefined, transport: any;
    try {
      const authorization = request.headers.get("authorization") || "";
      const actor = /^Bearer \S+$/i.test(authorization)
        ? await deps.authenticate(authorization.slice(7))
        : null;
      if (!actor)
        throw new FiscalError(
          "UNAUTHENTICATED",
          "Sua sessão expirou. Entre novamente no sistema.",
          401,
        );
      const master = actor.role === "master";
      if (
        !master &&
        (!actor.allowedUnits.includes("__income_write__") ||
          actor.hiddenScreens.includes("nfse"))
      )
        throw new FiscalError(
          "FORBIDDEN",
          "Acesso fiscal não autorizado.",
          403,
        );
      const params = { p_actor_id: actor.id, p_issuer_cnpj: ISSUER_CNPJ };
      const load = async () => ({
        ...(await deps.rpc("nfse_fiscal_load", params)),
        transmissionAvailable: deps.transmissionAvailable !== false,
      });
      if (request.method === "GET") return reply(await load());
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new FiscalError(
          "INVALID_REQUEST",
          "Envie os dados no formato JSON.",
          400,
        );
      const bytes = await limitedBytes(new Response(request.body), 96 * 1024);
      let body: any;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new FiscalError(
          "INVALID_REQUEST",
          "Dados não reconhecidos.",
          400,
        );
      }
      if (body?.environment !== undefined && body.environment !== 2)
        throw new FiscalError(
          "PRODUCTION_DISABLED",
          "A emissão em produção está bloqueada.",
          403,
        );
      const action = body?.action;
      if (
        [
          "config",
          "connection",
          "prepare",
          "send",
          "reconcile",
          "discard",
          "resume",
        ].includes(action) &&
        !master
      )
        throw new FiscalError(
          "FORBIDDEN",
          "Somente um usuário Master pode configurar e transmitir testes fiscais.",
          403,
        );
      const revision = (value: any) => {
        if (!Number.isSafeInteger(value) || value < 1)
          throw new FiscalError(
            "INVALID_REVISION",
            "Atualize os dados antes de continuar.",
            409,
          );
        return value;
      };
      if (
        deps.transmissionAvailable === false &&
        [
          "send",
          "prepare",
          "connection",
          "reconcile",
          "resume",
          "pdf",
        ].includes(action)
      )
        throw new FiscalError(
          "COMPATIBLE_SERVICE_REQUIRED",
          "A comunicação fiscal precisa do serviço de emissão compatível. Nenhum novo envio foi realizado.",
          503,
        );
      if (action === "config") {
        await deps.rpc("nfse_fiscal_config_save", {
          ...params,
          p_payload: cleanConfig(body.config),
          p_expected_revision: revision(body.revision),
        });
        return reply(await load());
      }
      if (action === "draft") {
        const draft = cleanDraft(body.draft);
        await deps.rpc("nfse_fiscal_draft_save", {
          ...params,
          p_id: draft.id,
          p_payload: draft,
          p_expected_revision:
            body.revision == null ? null : revision(body.revision),
        });
        return reply(await load());
      }
      if (action === "remove") {
        if (!isUuid(body.id))
          throw new FiscalError("INVALID_ID", "Rascunho inválido.");
        await deps.rpc("nfse_fiscal_draft_remove", {
          ...params,
          p_id: body.id,
          p_expected_revision: revision(body.revision),
        });
        return reply(await load());
      }
      if (
        ![
          "connection",
          "prepare",
          "send",
          "reconcile",
          "xml",
          "pdf",
          "discard",
          "resume",
        ].includes(action)
      )
        throw new FiscalError(
          "INVALID_ACTION",
          "Operação fiscal não reconhecida.",
          400,
        );
      let record: any;
      if (
        ["send", "reconcile", "xml", "pdf", "discard", "resume"].includes(
          action,
        )
      ) {
        if (!isUuid(body.id))
          throw new FiscalError("INVALID_ID", "Registro fiscal inválido.");
        record = await deps.rpc("nfse_fiscal_record", {
          ...params,
          p_id: body.id,
        });
        if (
          action === "resume" &&
          (body.confirmation !== "RETOMAR DPS" || record.status !== "unknown")
        )
          throw new FiscalError(
            "CONFIRMATION_REQUIRED",
            "Confirme a liberação da mesma DPS após consulta ao governo.",
          );
        if (action === "discard") {
          if (
            body.confirmation !== "DESCARTAR DPS" ||
            record.status !== "prepared"
          )
            throw new FiscalError(
              "CANNOT_DISCARD",
              "Só é possível descartar uma DPS preparada que ainda não foi enviada.",
            );
          await deps.rpc("nfse_fiscal_transition", {
            p_actor_id: actor.id,
            p_id: record.id,
            p_lease: record.lease,
            p_from: "prepared",
            p_to: "discarded",
            p_data: {},
          });
          return reply(await load());
        }
        if (action === "xml") {
          const xml = record.response_xml || record.signed_xml;
          if (!xml)
            throw new FiscalError(
              "XML_UNAVAILABLE",
              "A DPS ainda não foi preparada.",
            );
          return reply({
            xml,
            filename: `HOMOLOGACAO-${record.dps_id}.xml`,
            environment: 2,
          });
        }
      }
      const workspace = await load();
      let config = cleanConfig(workspace.config),
        draft: any;
      if (action === "prepare") {
        if (!isUuid(body.draftId))
          throw new FiscalError("INVALID_ID", "Rascunho inválido.");
        const saved = workspace.drafts.find(
          (item: any) => item.payload.id === body.draftId,
        );
        if (
          !saved ||
          saved.revision !== revision(body.draftRevision) ||
          workspace.configRevision !== revision(body.configRevision)
        )
          throw new FiscalError(
            "CONFLICT",
            "Os dados mudaram. Atualize a tela.",
            409,
          );
        draft = cleanDraft(saved.payload);
        const issues = draftIssues(config, draft);
        if (!config.setupReviewed || issues.length)
          throw new FiscalError(
            "INCOMPLETE_DRAFT",
            `Revise os dados antes de preparar a DPS: ${issues.join("; ") || "confirme a configuração do emissor"}.`,
          );
      }
      const certificate = await deps.rpc("nfse_fiscal_certificate", {
        p_issuer_cnpj: ISSUER_CNPJ,
      });
      if (!certificate)
        throw new FiscalError(
          "CERTIFICATE_REQUIRED",
          "Cadastre o certificado A1 antes de testar a conexão.",
        );
      if (
        new Date(certificate.metadata.validUntil) <= new Date() ||
        new Date(certificate.metadata.validFrom) > new Date()
      )
        throw new FiscalError(
          "CERTIFICATE_EXPIRED",
          "O certificado está fora do período de validade.",
          403,
        );
      if (!deps.rootsPem)
        throw new FiscalError(
          "NOT_CONFIGURED",
          "As raízes de confiança ainda não estão configuradas.",
          503,
        );
      try {
        secret = await openCertificate(
          certificate.envelope,
          ISSUER_CNPJ,
          certificate.id,
          deps.keys,
        );
      } catch {
        throw new FiscalError(
          "CERTIFICATE_CUSTODY",
          "Não foi possível abrir o A1 no serviço seguro. Contate o administrador.",
          503,
        );
      }
      const cert = String(secret.certificatePem),
        key = String(secret.privateKeyPem),
        chain = secret.chainPem as string[];
      let check: any;
      try {
        check = await deps.revocation(cert, chain, deps.rootsPem);
      } catch (error) {
        await deps.rpc("nfse_fiscal_check_save", {
          p_issuer_cnpj: ISSUER_CNPJ,
          p_fingerprint: certificate.metadata.fingerprint,
          p_result: {
            status:
              error instanceof FiscalError &&
              error.code === "CERTIFICATE_REVOKED"
                ? "revoked"
                : "unknown",
            connection: {
              code:
                error instanceof FiscalError ? error.code : "CERTIFICATE_CHECK",
            },
          },
        });
        throw error;
      }
      transport = deps.transport([cert, ...chain].join("\n"), key);
      let issuerDecision: IssuerRegistrationDecision | undefined;
      if (action === "connection" || action === "prepare") {
        let eligible: boolean | null = null,
          connection: any = {};
        try {
          issuerDecision = resolveIssuerRegistration(
            await transport.query(
              `/cnc/${config.issuer.municipalityCode}/${ISSUER_CNPJ}`,
            ),
            config.issuer,
            draft?.serviceDate || todayInBrazil(),
          );
          const agreement = await transport.query(
            `/parametros_municipais/${config.issuer.municipalityCode}/convenio`,
          );
          if (agreement.status !== 200)
            throw new FiscalError(
              "NATIONAL_CONVENTION",
              "O ambiente nacional não confirmou o convênio do município. Verifique a habilitação do emissor.",
              503,
            );
          eligible = nationalEligibility(agreement.data);
          const national = digits(
              draft?.serviceCode || config.settings.serviceCode,
            ),
            municipal =
              // An explicit empty draft value omits the municipal complement.
              // 000 identifies the national service in the parameter API only;
              // it must never be inserted as cTribMun in the signed DPS.
              digits(
                draft
                  ? draft.municipalServiceCode
                  : config.settings.municipalServiceCode,
              ) || "000";
          const serviceCode = `${national.slice(0, 2)}.${national.slice(2, 4)}.${national.slice(4, 6)}.${municipal}`;
          const service = await transport.query(
            `/parametros_municipais/${config.issuer.municipalityCode}/${serviceCode}/${draft?.serviceDate || todayInBrazil()}T00:00:00/aliquota`,
          );
          const integralWithoutRetention =
            config.issuer.taxRegime === "simples" &&
            config.settings.simplesAssessment === "1" &&
            (draft?.issWithheld || config.settings.issWithheld) === "nao";
          const missingRate =
            service.status === 404 &&
            service.data?.aliquotas === null &&
            /al[ií]quotas n[aã]o encontradas/i.test(
              service.data?.mensagem || "",
            );
          const connectionProbe = await transport.query(
            `/dps/DPS${config.issuer.municipalityCode}2${ISSUER_CNPJ}49999${"9".repeat(15)}`,
          );
          const emissionConnected =
            connectionProbe.status === 200 || dpsNotFound(connectionProbe);
          if (!emissionConnected)
            throw new FiscalError(
              "NATIONAL_CONNECTION",
              "A comunicação com o serviço de emissão não foi confirmada. Nenhuma DPS foi enviada.",
              503,
            );
          connection = {
            cnc: issuerDecision,
            connected: true,
            emissionConnected: true,
            municipalityCode: config.issuer.municipalityCode,
            serviceStatus: service.status,
            serviceValidated: service.status === 200,
            preparationAllowed:
              service.status === 200 ||
              (missingRate && integralWithoutRetention),
            warning: missingRate
              ? "A consulta não confirmou parâmetros para este código de serviço. O preparo é permitido pelo perfil integral do Simples sem retenção, com pAliq omitida, mas isso não confirma a validade do código municipal. Confira o código antes do envio; ele será validado pelo emissor nacional."
              : null,
            agreement: agreement.data,
            service: service.data,
          };
        } finally {
          await deps.rpc("nfse_fiscal_check_save", {
            p_issuer_cnpj: ISSUER_CNPJ,
            p_fingerprint: certificate.metadata.fingerprint,
            p_result: { ...check, eligible, connection },
          });
        }
        if (action === "connection") return reply(await load());
        if (eligible !== true || !connection.preparationAllowed)
          throw new FiscalError(
            "MUNICIPAL_ELIGIBILITY",
            "A consulta não confirmou a adesão ao emissor nacional e os parâmetros exigidos para esta operação. O preparo permanece bloqueado.",
          );
      } else
        await deps.rpc("nfse_fiscal_check_save", {
          p_issuer_cnpj: ISSUER_CNPJ,
          p_fingerprint: certificate.metadata.fingerprint,
          p_result: {
            ...check,
            eligible: workspace.connection?.eligible ?? null,
            connection: workspace.connection?.details || {},
          },
        });
      if (action === "prepare") {
        const started = await deps.rpc("nfse_fiscal_begin", {
          ...params,
          p_draft_id: draft.id,
          p_draft_revision: body.draftRevision,
          p_config_revision: body.configRevision,
        });
        record = started.record;
        if (!started.existing) {
          try {
            const xml = buildDps(
              cleanConfig(record.snapshot.config),
              cleanDraft(record.snapshot.draft),
              record.series,
              String(record.dps_number),
              record.created_at,
              issuerDecision,
            );
            const signed = deps.sign(xml, key, cert);
            await deps.rpc("nfse_fiscal_transition", {
              p_actor_id: actor.id,
              p_id: record.id,
              p_lease: record.lease,
              p_from: "preparing",
              p_to: "prepared",
              p_data: {
                signedXml: signed,
                certificateFingerprint: certificate.metadata.fingerprint,
              },
            });
          } catch (error) {
            await deps.rpc("nfse_fiscal_transition", {
              p_actor_id: actor.id,
              p_id: record.id,
              p_lease: record.lease,
              p_from: "preparing",
              p_to: "failed",
              p_data: {
                errors: [
                  {
                    code:
                      error instanceof FiscalError
                        ? error.code
                        : "PREPARATION_FAILED",
                    message:
                      "A preparação não foi concluída. Nenhuma DPS foi enviada.",
                  },
                ],
              },
            });
            throw error;
          }
        }
        return reply(await load());
      }
      const transition = (from: string, to: string, data: any = {}) =>
        deps.rpc("nfse_fiscal_transition", {
          p_actor_id: actor.id,
          p_id: record.id,
          p_lease: record.lease,
          p_from: from,
          p_to: to,
          p_data: data,
        });
      const authorize = async (data: any, from: string) => {
        const accessKey = data?.chaveAcesso;
        if (
          data?.tipoAmbiente !== 2 ||
          (data.idDps && data.idDps !== record.dps_id) ||
          typeof accessKey !== "string" ||
          !/^\d{50}$/.test(accessKey)
        )
          throw new FiscalError(
            "NATIONAL_RESPONSE",
            "A chave de acesso não foi confirmada.",
            502,
          );
        const response = data.nfseXmlGZipB64
          ? data
          : (await transport.query(`/nfse/${accessKey}`)).data;
        const xml = transport.unpack(response);
        deps.verifyResult(xml, record, accessKey);
        await transition(from, "authorized", {
          accessKey,
          responseXml: xml,
          errors: [],
        });
      };
      if (action === "resume") {
        const result = await transport.query(`/dps/${record.dps_id}`);
        if (result.status === 200 && result.data?.chaveAcesso) {
          await authorize(result.data, record.status);
          return reply(await load());
        }
        if (!dpsNotFound(result))
          throw new FiscalError(
            "LOOKUP_REQUIRED",
            "O governo ainda não confirmou a ausência desta DPS. Mantenha a consulta; nenhum reenvio foi liberado.",
            409,
          );
        await deps.rpc("nfse_fiscal_resume", {
          ...params,
          p_id: record.id,
          p_lease: record.lease,
          p_checked_at: new Date().toISOString(),
          p_http_status: 404,
          p_national_code: "E2404",
        });
        return reply(await load());
      }
      if (action === "pdf") {
        if (record.status !== "authorized")
          throw new FiscalError(
            "PDF_UNAVAILABLE",
            "O DANFSe depende da autorização no ambiente de testes.",
          );
        const result = await transport.pdf(record.access_key);
        return new Response(result.pdf, {
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="HOMOLOGACAO-${record.access_key}.pdf"`,
          },
        });
      }
      if (action === "reconcile") {
        if (record.status === "authorized") return reply(await load());
        if (!["sending", "unknown"].includes(record.status))
          throw new FiscalError(
            "NOT_PENDING",
            "Este teste não está aguardando consulta.",
          );
        const result = await transport.query(`/dps/${record.dps_id}`);
        if (result.status === 200 && result.data?.chaveAcesso)
          await authorize(result.data, record.status);
        else if (dpsNotFound(result))
          await transition(record.status, "unknown", {
            errors: [
              {
                code: "E2404",
                message:
                  "O emissor confirmou que não foi gerada NFS-e para esta DPS. É possível liberar uma nova tentativa com a mesma numeração, após confirmação.",
              },
            ],
          });
        else if (record.status === "sending")
          await transition("sending", "unknown", {
            errors: [
              {
                code: "AWAITING_CONFIRMATION",
                message:
                  "A autorização ainda não foi confirmada. Consulte novamente; o sistema não reenviará automaticamente.",
              },
            ],
          });
        return reply(await load());
      }
      if (action === "send") {
        if (body.confirmation !== "ENVIAR HOMOLOGACAO")
          throw new FiscalError(
            "CONFIRMATION_REQUIRED",
            "Confirme o envio de teste.",
          );
        if (record.status !== "prepared") return reply(await load());
        if (record.certificate_fingerprint !== certificate.metadata.fingerprint)
          throw new FiscalError(
            "CERTIFICATE_CHANGED",
            "O A1 mudou após o preparo. O envio está bloqueado.",
          );
        const snapshotConfig = cleanConfig(record.snapshot.config);
        const currentRegistration = resolveIssuerRegistration(
          await transport.query(
            `/cnc/${snapshotConfig.issuer.municipalityCode}/${ISSUER_CNPJ}`,
          ),
          snapshotConfig.issuer,
          cleanDraft(record.snapshot.draft).serviceDate,
        );
        assertDpsIssuerRegistration(record.signed_xml, currentRegistration);
        // This transaction wins exactly once. A timeout after it must be reconciled.
        await transition("prepared", "sending");
        try {
          const result = await transport.submit(record.signed_xml),
            errors = nationalErrors(result.data);
          if (result.status >= 200 && result.status < 300)
            await authorize(result.data, "sending");
          else if (
            result.status === 400 &&
            errors.length &&
            !errors.some(
              (e) =>
                e.code === "E0014" || /j[aá] existe|duplic/i.test(e.message),
            )
          )
            await transition("sending", "rejected", { errors });
          else
            await transition("sending", "unknown", {
              errors: errors.length
                ? errors
                : [
                    {
                      code: "AWAITING_CONFIRMATION",
                      message:
                        "Retorno inconclusivo. Consulte a DPS antes de qualquer novo envio.",
                    },
                  ],
            });
        } catch {
          await transition("sending", "unknown", {
            errors: [
              {
                code: "AWAITING_CONFIRMATION",
                message:
                  "A comunicação foi interrompida. Consulte a DPS; o envio não será repetido automaticamente.",
              },
            ],
          });
        }
        return reply(await load());
      }
      throw new FiscalError("INVALID_ACTION", "Operação não reconhecida.", 400);
    } catch (error) {
      return reply(
        {
          code:
            error instanceof FiscalError ? error.code : "FISCAL_UNAVAILABLE",
          error:
            error instanceof FiscalError
              ? error.message
              : "O serviço fiscal não concluiu a operação. Atualize o status antes de tentar novamente.",
        },
        error instanceof FiscalError ? error.status : 503,
      );
    } finally {
      transport?.close();
      if (secret) {
        secret.privateKeyPem = "";
        secret.certificatePem = "";
        secret.chainPem = [];
      }
    }
  };
}
