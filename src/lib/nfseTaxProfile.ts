import type { NfseIssuer, NfseSettings } from "./nfseDrafts.ts";

export const nfseCodeDigits = (value: string) => value.replace(/[.\s/-]/g, "");
export function nfseRate(value: string): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [integer, fraction = ""] = normalized.split(".");
  return `${Number(integer)}.${fraction.padEnd(2, "0")}`;
}
export const issAssessedInSimples = (
  issuer: NfseIssuer,
  settings: NfseSettings,
) => issuer.taxRegime === "simples" && settings.simplesAssessment === "1";
export const omitIssRate = (issuer: NfseIssuer, settings: NfseSettings) =>
  issAssessedInSimples(issuer, settings) && settings.issWithheld === "nao";

export function nfseFiscalIssues(
  issuer: NfseIssuer,
  settings: NfseSettings,
): string[] {
  const issues: string[] = [];
  if (
    issuer.personType !== "PJ" ||
    !/^\d{14}$/.test(issuer.document.replace(/\D/g, ""))
  )
    issues.push("CNPJ do emissor com 14 dígitos");
  if (!issuer.municipalRegistration.trim())
    issues.push("Inscrição municipal do emissor");
  if (issuer.taxRegime !== "simples")
    issues.push(
      "Enquadramento deste perfil de emissão: Simples Nacional ME/EPP",
    );
  if (!["1", "2", "3"].includes(settings.simplesAssessment))
    issues.push("Regime de apuração pelo Simples Nacional");
  else if (settings.simplesAssessment !== "1")
    issues.push(
      "Apuração fora do Simples: exige validação de um perfil fiscal específico",
    );
  if (issuer.specialRegime !== "0")
    issues.push(
      "Regime especial: Nenhum para apuração federal e municipal pelo Simples",
    );
  if (!/^\d{6}$/.test(nfseCodeDigits(settings.serviceCode)))
    issues.push("Código de tributação nacional com 6 dígitos");
  if (
    settings.municipalServiceCode &&
    (!/^\d{3}$/.test(nfseCodeDigits(settings.municipalServiceCode)) ||
      nfseCodeDigits(settings.municipalServiceCode) === "000")
  )
    issues.push(
      "Código de tributação municipal com 3 dígitos válidos; 000 não é permitido, deixe vazio quando não se aplicar",
    );
  if (!/^\d{9}$/.test(nfseCodeDigits(settings.nbsCode)))
    issues.push("Código NBS com 9 dígitos");
  if (!/^\d{7}$/.test(settings.issIncidenceMunicipalityCode))
    issues.push("Município de incidência do ISS: código IBGE com 7 dígitos");
  if (!nfseRate(settings.simplesRate))
    issues.push("Percentual informado do Simples Nacional (separado do ISS)");
  if (settings.issWithheld === "confirmar")
    issues.push("Retenção do ISS por operação");
  if (omitIssRate(issuer, settings) && settings.issRate.trim())
    issues.push(
      "Remover a alíquota de ISS destacada: nesta configuração ela deve ser omitida, não preenchida com zero ou 6%",
    );
  if (
    issAssessedInSimples(issuer, settings) &&
    settings.issWithheld === "sim"
  ) {
    const rate = nfseRate(settings.issRate);
    if (!rate || Number(rate) < 1.8 || Number(rate) > 5)
      issues.push(
        "Alíquota específica do ISS retido (1,80% a 5%), a confirmar com o contador",
      );
  }
  return issues;
}

// Normalized, non-transmitting preparation for the future DPS builder.
// A reported 6% SN rate belongs to approximate total taxation, never pAliq.
// Official references: RN E0175, E0625/E0631, E0621/E0628 and layout totTrib.
export function prepareNfseTaxProfile(
  issuer: NfseIssuer,
  settings: NfseSettings,
) {
  const issues = nfseFiscalIssues(issuer, settings);
  if (issues.length)
    throw new Error(`Confira a configuração fiscal: ${issues.join("; ")}.`);
  return {
    prestador: {
      CNPJ: issuer.document.replace(/\D/g, ""),
      IM: issuer.municipalRegistration.trim(),
      regTrib: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" },
    },
    servico: {
      cTribNac: nfseCodeDigits(settings.serviceCode),
      ...(settings.municipalServiceCode
        ? { cTribMun: nfseCodeDigits(settings.municipalServiceCode) }
        : {}),
      cNBS: nfseCodeDigits(settings.nbsCode),
    },
    incidenciaIss: {
      codigoMunicipio: settings.issIncidenceMunicipalityCode,
      cidade: settings.issIncidenceCity,
    },
    tributacao: {
      tribMun: {
        tribISSQN: "1",
        tpRetISSQN: settings.issWithheld === "nao" ? "1" : "2",
        ...(settings.issWithheld === "sim"
          ? { pAliq: nfseRate(settings.issRate)! }
          : {}),
      },
      totTrib: { pTotTribSN: nfseRate(settings.simplesRate)! },
    },
    // Fiscal submission still requires the customer's operation, DPS sequencing,
    // certificate/revocation checks, signing, XSD and municipal/API validation.
    transmitted: false as const,
    fiscalReady: false as const,
  };
}
