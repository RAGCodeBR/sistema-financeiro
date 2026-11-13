import { FiscalError, ISSUER_CNPJ, digits } from "./model.ts";

export type IssuerRegistrationDecision = {
  municipalRegistration: string | null;
  municipalityCode: string;
  checkedAt: string;
  source: "cnc";
};

// Absence must be explicitly confirmed by the national CNC, never inferred
// from a gateway 404, a denied certificate or an unavailable service.
export function resolveIssuerRegistration(
  result: { status: number; data: any },
  issuer: Record<string, string | boolean>,
  competence: string,
): IssuerRegistrationDecision {
  const data = result?.data;
  const decision = (
    municipalRegistration: string | null,
  ): IssuerRegistrationDecision => ({
    municipalRegistration,
    municipalityCode: String(issuer.municipalityCode),
    checkedAt: new Date().toISOString(),
    source: "cnc",
  });
  if (
    digits(issuer.document) !== ISSUER_CNPJ ||
    !/^\d{7}$/.test(String(issuer.municipalityCode)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(competence) ||
    data?.TipoAmbiente !== "HOMOLOGACAO" ||
    !Array.isArray(data?.Erros) ||
    data.Erros.length
  )
    throw new FiscalError(
      "CNC_UNCONFIRMED",
      "O CNC não confirmou o cadastro do emissor no ambiente de testes. Nenhuma DPS foi preparada ou enviada.",
      503,
    );

  const rows = data.ListaCadastroMunicipal;
  if (
    result.status === 404 &&
    data.StatusProcessamento === "NENHUM_DOCUMENTO_LOCALIZADO" &&
    (rows == null || (Array.isArray(rows) && rows.length === 0))
  )
    return decision(null);

  if (
    result.status !== 200 ||
    data.StatusProcessamento !== "DOCUMENTOS_LOCALIZADOS" ||
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 100 ||
    rows.some(
      (row: any) =>
        row?.OrigemDados !== "CNC" ||
        row.TipoAmbiente !== "HOMOLOGACAO" ||
        String(row.CodigoMunicipio) !== String(issuer.municipalityCode) ||
        row.InfCad?.Inscricao !== ISSUER_CNPJ ||
        row.InfCad?.TpInscricao !== "CNPJ",
    )
  )
    throw new FiscalError(
      "CNC_UNCONFIRMED",
      "A resposta do CNC não confirmou os dados deste emissor. Confira o cadastro antes de preparar outra DPS.",
      503,
    );

  const registration = String(issuer.municipalRegistration).trim();
  const matches = rows.filter(
    (row: any) => row.InfCad.InscricaoMunicipal === registration,
  );
  if (!registration || matches.length !== 1)
    throw new FiscalError(
      "CNC_IM_MISMATCH",
      "A inscrição municipal do cadastro não identifica um registro único no CNC. Revise o cadastro do emissor; o sistema não substituirá a inscrição automaticamente.",
    );
  const record = matches[0].InfCad;
  const start = record.DataApenasInicioInscricaoMunicipal;
  if (
    record.SituacaoEmissaoNFSe !== "HABILITADO" ||
    typeof start !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    start > competence
  )
    throw new FiscalError(
      "CNC_NOT_ELIGIBLE",
      "O registro complementar do emissor não confirmou habilitação e vigência para a competência informada. Confira o CNC antes de continuar.",
    );
  return decision(registration);
}

export function assertDpsIssuerRegistration(
  xml: string,
  decision: IssuerRegistrationDecision,
) {
  const provider = xml.match(/<prest>([\s\S]*?)<\/prest>/)?.[1];
  const value = provider?.match(/<IM>([^<]*)<\/IM>/)?.[1] ?? null;
  if (!provider || value !== decision.municipalRegistration)
    throw new FiscalError(
      "CNC_CHANGED",
      "A DPS preparada usa uma inscrição municipal diferente da regra atual do CNC. Descarte a DPS ainda não enviada, revise e salve o rascunho para preparar outra. Nenhuma transmissão foi feita.",
      409,
    );
}
