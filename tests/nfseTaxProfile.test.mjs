import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyNfseWorkspace,
  parseNfseWorkspace,
  applyConfirmedNfseReference,
  pendingNfseSetup,
} from "../src/lib/nfseDrafts.ts";
import {
  nfseFiscalIssues,
  prepareNfseTaxProfile,
  omitIssRate,
} from "../src/lib/nfseTaxProfile.ts";

test("confirmed Simples configuration keeps the reported 6% in total taxation and omits an ISS rate without retention", () => {
  const ws = emptyNfseWorkspace(),
    profile = prepareNfseTaxProfile(ws.issuer, ws.settings);
  assert.equal(ws.issuer.municipalRegistration, "3220285");
  assert.deepEqual(profile.prestador.regTrib, {
    opSimpNac: "3",
    regApTribSN: "1",
    regEspTrib: "0",
  });
  assert.equal(profile.tributacao.totTrib.pTotTribSN, "6.00");
  assert.equal(profile.tributacao.tribMun.tpRetISSQN, "1");
  assert.equal("pAliq" in profile.tributacao.tribMun, false);
  assert.equal(profile.fiscalReady, false);
  assert.equal(profile.transmitted, false);
  assert.equal(
    pendingNfseSetup(ws).some((item) => item.includes("Tributação do serviço")),
    false,
  );
});
test("national, municipal and NBS codes are normalized without losing the municipal leading zero", () => {
  const ws = emptyNfseWorkspace(),
    profile = prepareNfseTaxProfile(ws.issuer, ws.settings);
  assert.deepEqual(profile.servico, {
    cTribNac: "170101",
    cTribMun: "021",
    cNBS: "114011100",
  });
});
test("incidence municipality and place of service remain independent; no customer or invoice is imported from the reference", () => {
  const ws = emptyNfseWorkspace();
  assert.equal(ws.settings.issIncidenceCity, "Santos / SP");
  assert.equal(ws.settings.serviceCity, "");
  assert.equal(ws.drafts.length, 0);
  ws.settings.serviceCity = "Outra cidade / MT";
  const profile = prepareNfseTaxProfile(ws.issuer, ws.settings);
  assert.equal(profile.incidenciaIss.codigoMunicipio, "3548500");
  assert.equal("localPrestacao" in profile, false);
  assert.equal(ws.settings.serviceDescription, "CONSULTORIA EMPRESARIAL");
  assert.ok(!ws.settings.serviceDescription.includes("09/11/26"));
});
test("a stale ISS rate of 6 or zero is rejected instead of silently being used or interpreted as an exemption", () => {
  const ws = emptyNfseWorkspace();
  for (const rate of ["6", "0"]) {
    const settings = { ...ws.settings, issRate: rate };
    assert.equal(omitIssRate(ws.issuer, settings), true);
    assert.throws(
      () => prepareNfseTaxProfile(ws.issuer, settings),
      /Remover a alíquota de ISS/,
    );
  }
});
test("retention requires its own ISS rate and never falls back to the Simples total rate", () => {
  const ws = emptyNfseWorkspace();
  assert.throws(
    () =>
      prepareNfseTaxProfile(ws.issuer, { ...ws.settings, issWithheld: "sim" }),
    /Alíquota específica do ISS retido/,
  );
  assert.throws(
    () =>
      prepareNfseTaxProfile(ws.issuer, {
        ...ws.settings,
        issWithheld: "sim",
        issRate: "6",
      }),
    /Alíquota específica do ISS retido/,
  );
  const profile = prepareNfseTaxProfile(ws.issuer, {
    ...ws.settings,
    issWithheld: "sim",
    issRate: "2,01",
  });
  assert.equal(profile.tributacao.tribMun.pAliq, "2.01");
  assert.equal(profile.tributacao.tribMun.tpRetISSQN, "2");
  assert.equal(profile.tributacao.totTrib.pTotTribSN, "6.00");
});
test("unknown and unsupported assessments, special regimes and incomplete codes block preparation", () => {
  const ws = emptyNfseWorkspace();
  for (const change of [
    { simplesAssessment: "" },
    { simplesAssessment: "2" },
    { nbsCode: "" },
    { serviceCode: "17xyz" },
    { municipalServiceCode: "21" },
    { issWithheld: "confirmar" },
    { simplesRate: "6e2" },
  ])
    assert.ok(
      nfseFiscalIssues(ws.issuer, { ...ws.settings, ...change }).length > 0,
    );
  assert.ok(
    nfseFiscalIssues({ ...ws.issuer, specialRegime: "5" }, ws.settings).length >
      0,
  );
});
test("existing saved drafts retain their data and explicit tax values until the user reviews the confirmed reference", () => {
  const original = emptyNfseWorkspace();
  delete original.fiscalReferenceVersion;
  original.issuer.municipalRegistration = "";
  original.issuer.taxRegime = "";
  original.settings.issRate = "6";
  for (const key of [
    "nbsCode",
    "simplesAssessment",
    "simplesRate",
    "issIncidenceCity",
    "issIncidenceMunicipalityCode",
  ])
    delete original.settings[key];
  original.drafts = [
    {
      id: "existing-draft",
      customerName: "Cliente de teste",
      customerDocument: "",
      customerEmail: "",
      competence: "2026-11",
      description: "Descrição mantida",
      amount: "123,45",
      createdAt: "",
      updatedAt: "",
    },
  ];
  const restored = parseNfseWorkspace(JSON.stringify(original));
  assert.equal(restored.fiscalReferenceVersion, 0);
  assert.equal(restored.issuer.municipalRegistration, "");
  assert.equal(restored.settings.issRate, "6");
  assert.equal(restored.settings.simplesAssessment, "");
  const reviewed = applyConfirmedNfseReference(restored);
  assert.equal(reviewed.issuer.municipalRegistration, "3220285");
  assert.equal(reviewed.settings.issRate, "");
  assert.equal(reviewed.settings.simplesRate, "6");
  assert.deepEqual(reviewed.drafts, restored.drafts);
  assert.equal(restored.settings.issRate, "6");
  assert.deepEqual(parseNfseWorkspace(JSON.stringify(reviewed)), reviewed);
});
test("confirmed issuer data cannot be applied to a different CNPJ and unrecognized secret properties stay out of draft storage", () => {
  const ws = emptyNfseWorkspace();
  assert.throws(
    () =>
      applyConfirmedNfseReference({
        ...ws,
        issuer: { ...ws.issuer, document: "12.345.678/0001-90" },
      }),
    /pertencem ao CNPJ/,
  );
  const raw = {
    ...ws,
    settings: { ...ws.settings, password: "NEVER-PERSIST" },
    certificate: "NEVER-PERSIST",
  };
  assert.ok(
    !JSON.stringify(parseNfseWorkspace(JSON.stringify(raw))).includes(
      "NEVER-PERSIST",
    ),
  );
});
