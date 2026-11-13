import type { IssuerRegistrationDecision } from "./issuer.ts";

export class FiscalError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export const ISSUER_CNPJ = "60371448000143";
export const issuerFields = [
  "personType",
  "document",
  "legalName",
  "tradeName",
  "municipalRegistration",
  "stateRegistration",
  "taxRegime",
  "specialRegime",
  "cnae",
  "email",
  "phone",
  "postalCode",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "municipalityCode",
];
export const settingFields = [
  "serviceCode",
  "municipalServiceCode",
  "nbsCode",
  "serviceDescription",
  "simplesAssessment",
  "simplesRate",
  "issRate",
  "issWithheld",
  "serviceCity",
  "issIncidenceCity",
  "issIncidenceMunicipalityCode",
];
export const draftFields = [
  "id",
  "customerName",
  "customerDocument",
  "customerEmail",
  "competence",
  "description",
  "amount",
  "createdAt",
  "updatedAt",
  "serviceDate",
  "customerPostalCode",
  "customerStreet",
  "customerNumber",
  "customerComplement",
  "customerDistrict",
  "customerCity",
  "customerState",
  "customerMunicipalityCode",
  "serviceCity",
  "serviceMunicipalityCode",
  "serviceCode",
  "municipalServiceCode",
  "nbsCode",
  "issWithheld",
  "issRate",
  "federalRetention",
];
export type FiscalDraft = Record<string, string>;
export type FiscalConfig = {
  issuer: Record<string, string | boolean>;
  settings: Record<string, string>;
  setupReviewed: boolean;
  fiscalReferenceVersion: number;
};
export const digits = (value: unknown) =>
  String(value ?? "").replace(/[.\s/()-]/g, "");
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
function strings(value: unknown, fields: string[]): Record<string, string> {
  if (!object(value))
    throw new FiscalError(
      "INVALID_DATA",
      "Os dados fiscais não têm o formato esperado.",
    );
  const result: Record<string, string> = {};
  for (const key of fields) {
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new FiscalError(
        "INVALID_DATA",
        "Confira o formato dos campos fiscais.",
      );
    const text = String(value[key] ?? "");
    if (
      text.length >
        (key === "description" || key === "serviceDescription" ? 8000 : 300) ||
      /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)
    )
      throw new FiscalError(
        "INVALID_DATA",
        "Há um campo fiscal inválido ou muito extenso.",
      );
    result[key] = text;
  }
  return result;
}
export function cleanConfig(value: unknown): FiscalConfig {
  if (!object(value))
    throw new FiscalError(
      "INVALID_CONFIG",
      "Confira a configuração do emissor.",
    );
  const issuer = strings(value.issuer, issuerFields);
  if (digits(issuer.document) !== ISSUER_CNPJ || issuer.personType !== "PJ")
    throw new FiscalError(
      "ISSUER_MISMATCH",
      "O CNPJ do emissor deve ser 60.371.448/0001-43.",
    );
  issuer.document = "60.371.448/0001-43";
  return {
    issuer: {
      ...issuer,
      stateExempt: object(value.issuer) && value.issuer.stateExempt === true,
    },
    settings: strings(value.settings, settingFields),
    setupReviewed: value.setupReviewed === true,
    fiscalReferenceVersion: 1,
  };
}
export function cleanDraft(value: unknown): FiscalDraft {
  const draft = strings(value, draftFields);
  if (!isUuid(draft.id) || !draft.customerName.trim())
    throw new FiscalError(
      "INVALID_DRAFT",
      "Informe o nome do cliente e um identificador válido para o rascunho.",
    );
  draft.customerName = draft.customerName.trim();
  draft.competence = draft.serviceDate
    ? draft.serviceDate.slice(0, 7)
    : draft.competence;
  return draft;
}
export function validDocument(value: string): boolean {
  const text = digits(value);
  if (!/^\d{11}(\d{3})?$/.test(text) || /^(\d)\1+$/.test(text)) return false;
  if (text.length === 11) {
    for (let count = 9; count <= 10; count++) {
      const sum = [...text.slice(0, count)].reduce(
        (n, d, i) => n + Number(d) * (count + 1 - i),
        0,
      );
      const check = ((sum * 10) % 11) % 10;
      if (check !== Number(text[count])) return false;
    }
    return true;
  }
  for (let count = 12; count <= 13; count++) {
    const sum = [...text.slice(0, count)].reduce(
      (n, d, i) => n + Number(d) * (((count - 1 - i) % 8) + 2),
      0,
    );
    const remainder = sum % 11;
    if ((remainder < 2 ? 0 : 11 - remainder) !== Number(text[count]))
      return false;
  }
  return true;
}
export function cents(value: string): number {
  let text = value.trim();
  if (text.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text)) return NaN;
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return NaN;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result <= 99999999999999
    ? result
    : NaN;
}
export function rate(value: string): string | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${Number(whole)}.${fraction.padEnd(2, "0")}`;
}
export function todayInBrazil(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dpsEmissionDateTime(now: Date): string {
  // Keep the original instant, expressed in the issuer's local timezone.
  // The national service returns dhProc with this offset as well.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  const offset = parts.timeZoneName.replace(/^GMT/, "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
export function draftIssues(
  config: FiscalConfig,
  draft: FiscalDraft,
  now = new Date(),
): string[] {
  const issues: string[] = [],
    { issuer, settings } = config;
  if (digits(issuer.document) !== ISSUER_CNPJ) issues.push("CNPJ do emissor");
  if (!String(issuer.municipalRegistration).trim())
    issues.push("Inscrição municipal");
  if (
    issuer.taxRegime !== "simples" ||
    settings.simplesAssessment !== "1" ||
    issuer.specialRegime !== "0"
  )
    issues.push(
      "Perfil suportado: ME/EPP com tributos federais e ISS pelo Simples, sem regime especial",
    );
  if (!/^\d{7}$/.test(String(issuer.municipalityCode)))
    issues.push("Código IBGE do emissor");
  if (!rate(settings.simplesRate))
    issues.push("Percentual informado do Simples");
  if (!validDocument(draft.customerDocument))
    issues.push("CPF/CNPJ válido do cliente");
  if (!draft.customerName.trim() || draft.customerName.length > 150)
    issues.push("Nome do cliente (até 150 caracteres)");
  if (
    draft.customerEmail &&
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(draft.customerEmail)
  )
    issues.push("E-mail do cliente");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(draft.serviceDate)
    ? new Date(`${draft.serviceDate}T12:00:00Z`)
    : null;
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== draft.serviceDate ||
    draft.serviceDate > todayInBrazil(now)
  )
    issues.push("Data completa da competência, válida e até hoje");
  if (!/^\d{8}$/.test(digits(draft.customerPostalCode)))
    issues.push("CEP do cliente");
  if (!/^\d{7}$/.test(draft.customerMunicipalityCode))
    issues.push("Código IBGE do município do cliente");
  for (const [key, label] of [
    ["customerStreet", "Logradouro"],
    ["customerNumber", "Número"],
    ["customerDistrict", "Bairro"],
  ])
    if (
      !draft[key].trim() ||
      draft[key].length > (key === "customerNumber" ? 60 : 255)
    )
      issues.push(`${label} do cliente`);
  if (!/^\d{7}$/.test(draft.serviceMunicipalityCode))
    issues.push("Código IBGE do local da prestação");
  if (!/^\d{6}$/.test(digits(draft.serviceCode)))
    issues.push("Código nacional do serviço");
  if (
    draft.municipalServiceCode &&
    (!/^\d{3}$/.test(digits(draft.municipalServiceCode)) ||
      digits(draft.municipalServiceCode) === "000")
  )
    issues.push(
      "Código municipal do serviço: informe 3 dígitos válidos ou deixe vazio quando não se aplicar; 000 não é permitido na DPS",
    );
  if (!/^\d{9}$/.test(digits(draft.nbsCode))) issues.push("Código NBS");
  if (!draft.description.trim() || draft.description.length > 1900)
    issues.push("Descrição do serviço (até 1900 caracteres)");
  if (!(cents(draft.amount) > 0))
    issues.push("Valor do serviço maior que zero, com até duas casas decimais");
  if (!["nao", "sim"].includes(draft.issWithheld))
    issues.push("Retenção do ISS nesta operação");
  if (draft.issWithheld === "nao" && draft.issRate.trim())
    issues.push("Alíquota de ISS deve ser omitida na operação sem retenção");
  if (
    draft.issWithheld === "sim" &&
    (!rate(draft.issRate) ||
      Number(rate(draft.issRate)) < 1.8 ||
      Number(rate(draft.issRate)) > 5)
  )
    issues.push("Alíquota específica de ISS retido (1,80% a 5%)");
  if (draft.federalRetention !== "nao")
    issues.push(
      "O perfil atual suporta operações sem retenções federais; revisar com o contador",
    );
  return issues;
}
export const xmlText = (value: unknown): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const tag = (name: string, value: unknown) =>
  `<${name}>${xmlText(value)}</${name}>`;
export function dpsId(
  config: FiscalConfig,
  series: number,
  number: string,
): string {
  if (
    !Number.isInteger(series) ||
    series < 1 ||
    series > 49999 ||
    !/^[1-9]\d{0,14}$/.test(number)
  )
    throw new FiscalError(
      "INVALID_DPS_NUMBER",
      "Numeração de DPS inválida para o sistema próprio.",
    );
  return `DPS${config.issuer.municipalityCode}2${ISSUER_CNPJ}${String(series).padStart(5, "0")}${number.padStart(15, "0")}`;
}
export function buildDps(
  config: FiscalConfig,
  draft: FiscalDraft,
  series: number,
  number: string,
  emittedAt: string,
  issuerDecision?: IssuerRegistrationDecision,
): string {
  const now = new Date(emittedAt),
    issues = draftIssues(config, draft, now);
  if (issues.length)
    throw new FiscalError(
      "INCOMPLETE_DRAFT",
      `Confira antes de preparar a DPS: ${issues.join("; ")}.`,
    );
  const id = dpsId(config, series, number),
    { issuer, settings } = config;
  const registration = issuerDecision
    ? issuerDecision.municipalRegistration
    : String(issuer.municipalRegistration).trim();
  if (
    issuerDecision &&
    (issuerDecision.source !== "cnc" ||
      issuerDecision.municipalityCode !== String(issuer.municipalityCode) ||
      (registration !== null &&
        registration !== String(issuer.municipalRegistration).trim()))
  )
    throw new FiscalError(
      "CNC_IM_MISMATCH",
      "A decisão do CNC não corresponde ao cadastro do emissor.",
    );
  const address = `<end><endNac>${tag("cMun", draft.customerMunicipalityCode)}${tag("CEP", digits(draft.customerPostalCode))}</endNac>${tag("xLgr", draft.customerStreet)}${tag("nro", draft.customerNumber)}${draft.customerComplement ? tag("xCpl", draft.customerComplement) : ""}${tag("xBairro", draft.customerDistrict)}</end>`;
  const customerDocument = digits(draft.customerDocument);
  const amount = cents(draft.amount);
  return (
    `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${id}">` +
    tag("tpAmb", "2") +
    tag("dhEmi", dpsEmissionDateTime(now)) +
    tag("verAplic", "FinCore-1.0") +
    tag("serie", String(series).padStart(5, "0")) +
    tag("nDPS", number) +
    tag("dCompet", draft.serviceDate) +
    tag("tpEmit", "1") +
    tag("finNFSe", "0") +
    tag("cLocEmi", issuer.municipalityCode) +
    `<prest>${tag("CNPJ", ISSUER_CNPJ)}${registration === null ? "" : tag("IM", registration)}<regTrib>${tag("opSimpNac", "3")}${tag("regApTribSN", "1")}${tag("regEspTrib", "0")}</regTrib></prest>` +
    `<toma>${tag(customerDocument.length === 14 ? "CNPJ" : "CPF", customerDocument)}${tag("xNome", draft.customerName)}${address}${draft.customerEmail ? tag("email", draft.customerEmail) : ""}</toma>` +
    `<serv><locPrest>${tag("cLocPrestacao", draft.serviceMunicipalityCode)}</locPrest><cServ>${tag("cTribNac", digits(draft.serviceCode))}${draft.municipalServiceCode ? tag("cTribMun", digits(draft.municipalServiceCode)) : ""}${tag("cNBS", digits(draft.nbsCode))}${tag("xDescServ", `TESTE DE HOMOLOGACAO - SEM VALOR FISCAL. ${draft.description}`)}</cServ></serv>` +
    `<valores><vServPrest>${tag("vServ", `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`)}</vServPrest><trib><tribMun>${tag("tribISSQN", "1")}${tag("tpRetISSQN", draft.issWithheld === "nao" ? "1" : "2")}${draft.issWithheld === "sim" ? tag("pAliq", rate(draft.issRate)) : ""}</tribMun><totTrib>${tag("pTotTribSN", rate(settings.simplesRate))}</totTrib></trib></valores></infDPS></DPS>`
  );
}
