// Local preparation only. Fiscal authorization, certificates and financial entries
// deliberately have no representation in this draft store.
export type NfseIssuer = {
  personType: "PJ" | "PF";
  document: string;
  legalName: string;
  tradeName: string;
  municipalRegistration: string;
  stateRegistration: string;
  stateExempt: boolean;
  taxRegime: string;
  specialRegime: string;
  cnae: string;
  email: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  municipalityCode: string;
};
export type NfseSettings = {
  serviceCode: string;
  municipalServiceCode: string;
  serviceDescription: string;
  issRate: string;
  issWithheld: "confirmar" | "nao" | "sim";
  serviceCity: string;
};
export type NfseDraft = {
  id: string;
  customerName: string;
  customerDocument: string;
  customerEmail: string;
  competence: string;
  description: string;
  amount: string;
  createdAt: string;
  updatedAt: string;
};
export type NfseWorkspace = {
  version: 1;
  issuer: NfseIssuer;
  settings: NfseSettings;
  setupReviewed: boolean;
  drafts: NfseDraft[];
};

export function emptyNfseWorkspace(): NfseWorkspace {
  return {
    version: 1,
    issuer: {
      personType: "PJ",
      document: "60.371.448/0001-43",
      legalName: "LAURO ALVES DE OLIVEIRA JUNIOR LTDA",
      tradeName: "",
      municipalRegistration: "",
      stateRegistration: "",
      stateExempt: false,
      taxRegime: "",
      specialRegime: "",
      cnae: "",
      email: "",
      phone: "",
      postalCode: "11045-002",
      street: "CONSELHEIRO NEBIAS",
      number: "756",
      complement: "CONJ 1011",
      district: "BOQUEIRAO",
      city: "Santos",
      state: "SP",
      municipalityCode: "3548500",
    },
    settings: {
      serviceCode: "",
      municipalServiceCode: "",
      serviceDescription: "",
      issRate: "",
      issWithheld: "confirmar",
      serviceCity: "Santos / SP",
    },
    setupReviewed: false,
    drafts: [],
  };
}

export const nfseStorageKey = (scope: string) =>
  `fincore:nfse-drafts:v1:${encodeURIComponent(scope)}`;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

// Copy only the known draft fields. Never persist an uploaded certificate,
// passwords, tokens or arbitrary imported properties.
function knownStrings<T extends object>(
  defaults: T,
  input: Record<string, unknown>,
): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (
      typeof defaults[key] === "string" &&
      typeof input[String(key)] === "string"
    ) {
      result[key] = String(input[String(key)]).slice(0, 8000) as T[keyof T];
    }
  }
  return result;
}

export function parseNfseWorkspace(raw: string | null): NfseWorkspace {
  const base = emptyNfseWorkspace();
  if (raw === null) return base;
  const value: unknown = JSON.parse(raw);
  if (
    !record(value) ||
    value.version !== 1 ||
    !record(value.issuer) ||
    !record(value.settings) ||
    !Array.isArray(value.drafts)
  ) {
    throw new Error(
      "O rascunho de NFS-e salvo neste navegador não pôde ser lido. Seus dados não foram substituídos.",
    );
  }
  const issuer = knownStrings(base.issuer, value.issuer);
  issuer.personType = value.issuer.personType === "PF" ? "PF" : "PJ";
  issuer.stateExempt = value.issuer.stateExempt === true;
  const settings = knownStrings(base.settings, value.settings);
  settings.issWithheld =
    value.settings.issWithheld === "sim"
      ? "sim"
      : value.settings.issWithheld === "nao"
        ? "nao"
        : "confirmar";
  const seen = new Set<string>();
  const drafts = value.drafts.map((item): NfseDraft => {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id)
    )
      throw new Error(
        "Há um rascunho de nota inválido neste navegador. Os dados salvos foram preservados.",
      );
    seen.add(item.id);
    return knownStrings(
      {
        id: "",
        customerName: "",
        customerDocument: "",
        customerEmail: "",
        competence: "",
        description: "",
        amount: "",
        createdAt: "",
        updatedAt: "",
      },
      item,
    );
  });
  return {
    version: 1,
    issuer,
    settings,
    setupReviewed: value.setupReviewed === true,
    drafts,
  };
}

export function pendingNfseSetup(workspace: NfseWorkspace): string[] {
  const missing: string[] = [];
  if (!workspace.issuer.legalName.trim()) missing.push("Razão social");
  if (!workspace.issuer.document.trim()) missing.push("Documento do emissor");
  if (!workspace.issuer.municipalRegistration.trim())
    missing.push("Inscrição municipal");
  if (!workspace.issuer.taxRegime) missing.push("Regime tributário");
  if (!workspace.settings.serviceCode.trim()) missing.push("Código de serviço");
  if (!workspace.settings.issRate.trim()) missing.push("Tributação do serviço");
  missing.push("Certificado A1 e integração fiscal");
  return missing;
}
