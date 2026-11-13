// Emitter configuration supplied by the user and checked against their DANFSe.
// No customer, invoice amount, invoice key or private document is bundled here.
export const NFSE_FISCAL_REFERENCE_VERSION = 1;
export const NFSE_FISCAL_REFERENCE_CNPJ = "60371448000143";
export const confirmedNfseIssuer = {
  municipalRegistration: "3220285",
  taxRegime: "simples",
  // RN E0175: ME/EPP, with federal and municipal taxes assessed under SN.
  specialRegime: "0",
};
export const confirmedNfseSettings = {
  serviceCode: "17.01.01",
  municipalServiceCode: "021",
  nbsCode: "1.1401.11.00",
  serviceDescription: "CONSULTORIA EMPRESARIAL",
  simplesAssessment: "1",
  simplesRate: "6",
  issRate: "",
  issWithheld: "nao" as const,
  // Place of service is operation-specific; the example's customer city is not
  // a default for every invoice and must not replace the ISS incidence city.
  serviceCity: "",
  issIncidenceCity: "Santos / SP",
  issIncidenceMunicipalityCode: "3548500",
};
