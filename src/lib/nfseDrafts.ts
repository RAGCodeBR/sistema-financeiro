// Local preparation only. Fiscal authorization, certificates and financial entries
// deliberately have no representation in this draft store.
import {
  confirmedNfseIssuer,
  confirmedNfseSettings,
  NFSE_FISCAL_REFERENCE_CNPJ,
  NFSE_FISCAL_REFERENCE_VERSION,
} from "./nfseFiscalReference.ts";
import { nfseFiscalIssues } from "./nfseTaxProfile.ts";
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
  nbsCode: string;
  simplesAssessment: string;
  simplesRate: string;
  issIncidenceCity: string;
  issIncidenceMunicipalityCode: string;
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
} & Partial<
  Record<
    | "serviceDate"
    | "customerPostalCode"
    | "customerStreet"
    | "customerNumber"
    | "customerComplement"
    | "customerDistrict"
    | "customerCity"
    | "customerState"
    | "customerMunicipalityCode"
    | "serviceCity"
    | "serviceMunicipalityCode"
    | "serviceCode"
    | "municipalServiceCode"
    | "nbsCode"
    | "issWithheld"
    | "issRate"
    | "federalRetention",
    string
  >
>;
export const nfseOperationDefaults = () => ({
  serviceDate: "",
  customerPostalCode: "",
  customerStreet: "",
  customerNumber: "",
  customerComplement: "",
  customerDistrict: "",
  customerCity: "",
  customerState: "",
  customerMunicipalityCode: "",
  serviceCity: "",
  serviceMunicipalityCode: "",
  serviceCode: "",
  municipalServiceCode: "",
  nbsCode: "",
  issWithheld: "",
  issRate: "",
  federalRetention: "",
});
export type NfseWorkspace = {
  version: 1;
  fiscalReferenceVersion: number;
  issuer: NfseIssuer;
  settings: NfseSettings;
  setupReviewed: boolean;
  drafts: NfseDraft[];
};

export function emptyNfseWorkspace(): NfseWorkspace {
  return {
    version: 1,
    fiscalReferenceVersion: NFSE_FISCAL_REFERENCE_VERSION,
    issuer: {
      personType: "PJ",
      document: "60.371.448/0001-43",
      legalName: "LAURO ALVES DE OLIVEIRA JUNIOR LTDA",
      tradeName: "",
      municipalRegistration: confirmedNfseIssuer.municipalRegistration,
      stateRegistration: "",
      stateExempt: false,
      taxRegime: confirmedNfseIssuer.taxRegime,
      specialRegime: confirmedNfseIssuer.specialRegime,
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
    settings: { ...confirmedNfseSettings },
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
  const referenceVersion =
    typeof value.fiscalReferenceVersion === "number" &&
    Number.isSafeInteger(value.fiscalReferenceVersion) &&
    value.fiscalReferenceVersion >= 0
      ? value.fiscalReferenceVersion
      : 0;
  // Legacy drafts keep their explicit values and are offered a review action;
  // new fiscal fields are not silently applied to a saved configuration.
  const issuerDefaults =
    referenceVersion < NFSE_FISCAL_REFERENCE_VERSION
      ? {
          ...base.issuer,
          municipalRegistration: "",
          taxRegime: "",
          specialRegime: "",
        }
      : base.issuer;
  const settingsDefaults =
    referenceVersion < NFSE_FISCAL_REFERENCE_VERSION
      ? {
          ...base.settings,
          nbsCode: "",
          simplesAssessment: "",
          simplesRate: "",
          issIncidenceCity: "",
          issIncidenceMunicipalityCode: "",
        }
      : base.settings;
  const issuer = knownStrings(issuerDefaults, value.issuer);
  issuer.personType = value.issuer.personType === "PF" ? "PF" : "PJ";
  issuer.stateExempt = value.issuer.stateExempt === true;
  const settings = knownStrings(settingsDefaults, value.settings);
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
        ...nfseOperationDefaults(),
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
    fiscalReferenceVersion: referenceVersion,
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
  missing.push(...nfseFiscalIssues(workspace.issuer, workspace.settings));
  missing.push("Integração fiscal e checagem de revogação do A1");
  return missing;
}

export function applyConfirmedNfseReference(
  workspace: NfseWorkspace,
): NfseWorkspace {
  if (
    workspace.issuer.document.replace(/\D/g, "") !== NFSE_FISCAL_REFERENCE_CNPJ
  )
    throw new Error(
      "Os dados confirmados pertencem ao CNPJ 60.371.448/0001-43. Confira o emissor antes de aplicar.",
    );
  return {
    ...workspace,
    fiscalReferenceVersion: NFSE_FISCAL_REFERENCE_VERSION,
    issuer: { ...workspace.issuer, ...confirmedNfseIssuer },
    settings: { ...workspace.settings, ...confirmedNfseSettings },
  };
}
