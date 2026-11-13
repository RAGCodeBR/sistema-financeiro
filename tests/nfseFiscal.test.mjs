import assert from "node:assert/strict";
import { test, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import forge from "node-forge";
import * as libxml from "libxml2-wasm";
import { SignedXml } from "xml-crypto";
import {
  cleanConfig,
  cleanDraft,
  draftIssues,
  buildDps,
  validDocument,
  cents,
} from "../supabase/functions/_shared/nfse-fiscal/model.ts";
import { createXmlEngine } from "../supabase/functions/_shared/nfse-fiscal/xml.ts";
import { resolveIssuerRegistration } from "../supabase/functions/_shared/nfse-fiscal/issuer.ts";
import { emptyNfseWorkspace } from "../src/lib/nfseDrafts.ts";
import {
  certificateFixture,
  testPassword,
} from "./helpers/nfseCertificateFixtures.mjs";
export const config = cleanConfig({
  ...emptyNfseWorkspace(),
  setupReviewed: true,
});
export const draft = cleanDraft({
  id: crypto.randomUUID(),
  customerName: "CLIENTE SINTETICO HOMOLOGACAO",
  customerDocument: "52998224725",
  customerEmail: "teste@example.com",
  serviceDate: "2026-11-01",
  customerPostalCode: "11045002",
  customerStreet: "RUA TESTE",
  customerNumber: "1",
  customerDistrict: "CENTRO",
  customerMunicipalityCode: "3548500",
  serviceMunicipalityCode: "3548500",
  serviceCode: "17.01.01",
  municipalServiceCode: "021",
  nbsCode: "1.1401.11.00",
  description: "Servico sintetico & teste",
  amount: "123,45",
  issWithheld: "nao",
  issRate: "",
  federalRetention: "nao",
});
const schemas = {};
const folder = new URL(
  "../supabase/functions/nfse-fiscal/schemas/",
  import.meta.url,
);
for (const name of await readdir(folder))
  if (name.endsWith(".xsd"))
    schemas[name] = await readFile(new URL(name, folder), "utf8");
const engine = createXmlEngine({ ...libxml, SignedXml }, schemas);
after(() => engine.dispose());
test("DPS uses sandbox, API series, exact cents and omits ISS rate under integral Simples", () => {
  assert.equal(validDocument("60.371.448/0001-43"), true);
  assert.equal(validDocument("52998224725"), true);
  assert.equal(validDocument("11111111111"), false);
  assert.equal(cents("3.604,34"), 360434);
  assert.ok(Number.isNaN(cents("12,345")));
  assert.deepEqual(draftIssues(config, draft, new Date("2026-11-13")), []);
  const xml = buildDps(config, draft, 1, "1", "2026-11-13T12:00:00Z");
  engine.validate(xml);
  assert.match(xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(xml, /<pTotTribSN>6.00<\/pTotTribSN>/);
  assert.doesNotMatch(xml, /<pAliq>/);
  assert.match(xml, /<vServ>123.45<\/vServ>/);
  assert.throws(
    () => buildDps(config, draft, 70000, "1", "2026-11-13T12:00:00Z"),
    /DPS/,
  );
  assert.throws(
    () => engine.validate(xml.replace("<vServ>123.45", "<vServ>abc")),
    /esquema/,
  );
  assert.throws(
    () => engine.validate('<!DOCTYPE DPS SYSTEM="file:///private">' + xml),
    /permitido/,
  );
});
test("XML signature validates against national XSD and uses explicit trusted certificate", () => {
  const fixture = certificateFixture();
  const p12 = forge.pkcs12.pkcs12FromAsn1(fixture.asn, testPassword);
  const bag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ][0];
  const xml = buildDps(config, draft, 1, "2", "2026-11-13T12:00:00Z");
  const signed = engine.sign(
    xml,
    forge.pki.privateKeyToPem(bag.key),
    forge.pki.certificateToPem(fixture.cert),
  );
  assert.match(signed, /<Signature/);
  assert.match(signed, /rsa-sha256/);
  engine.validate(signed);
  const id = signed.match(/infDPS Id="([^"]+)"/)[1],
    key = "2".repeat(50),
    response = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${key}">${signed.replace(/<\?xml[^>]+\?>/, "")}</infNFSe></NFSe>`;
  engine.verifyResult(response, { signed_xml: signed, dps_id: id }, key);
  assert.throws(
    () =>
      engine.verifyResult(
        response.replace("<vServ>123.45", "<vServ>999.99"),
        { signed_xml: signed, dps_id: id },
        key,
      ),
    (e) => e.code === "NATIONAL_XML",
  );
});
test("homologation NT009 release 1 requires note purpose and NBS before description (E1235 regression)", () => {
  const xml = buildDps(config, draft, 1, "3", "2026-11-13T12:00:00Z");
  assert.match(xml, /<tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe><cLocEmi>/);
  assert.match(xml, /<cNBS>114011100<\/cNBS><xDescServ>/);
  engine.validate(xml);
  const missingPurpose = xml.replace("<finNFSe>0</finNFSe>", "");
  const oldServiceOrder = xml.replace(
    /(<cNBS>\d+<\/cNBS>)(<xDescServ>[\s\S]*?<\/xDescServ>)/,
    "$2$1",
  );
  for (const invalid of [missingPurpose, oldServiceOrder])
    assert.throws(
      () => engine.validate(invalid),
      (error) => error.code === "XSD_VALIDATION",
    );
});
test("DPS emission uses Brasilia offset without shifting the database instant, including local midnight (E0008 regression)", () => {
  const cases = [
    ["2026-11-13T16:18:55.872442+00:00", "2026-11-13T13:18:55-03:00"],
    ["2026-11-13T02:30:00Z", "2026-11-12T23:30:00-03:00"],
    ["2026-11-13T03:00:00Z", "2026-11-13T00:00:00-03:00"],
    ["2026-11-13T13:18:55-03:00", "2026-11-13T13:18:55-03:00"],
  ];
  for (const [createdAt, expected] of cases) {
    const xml = buildDps(config, draft, 1, "4", createdAt);
    const emittedAt = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)[1];
    assert.equal(emittedAt, expected);
    assert.equal(
      Date.parse(emittedAt),
      Math.floor(Date.parse(createdAt) / 1000) * 1000,
    );
    engine.validate(xml);
  }
});
test("bundled XSDs match the pinned official homologation release", async () => {
  const source = JSON.parse(
    await readFile(new URL("source.json", folder), "utf8"),
  );
  assert.equal(source.environment, "homologation");
  assert.equal(source.release, "2026-10-20");
  assert.match(
    source.url,
    /^https:\/\/www\.gov\.br\/nfse\/.*producao-restrita\//,
  );
  for (const file of source.files)
    assert.equal(
      createHash("sha256")
        .update(await readFile(new URL(file.name, folder)))
        .digest("hex"),
      file.sha256,
    );
});
test("an explicitly blank municipal code stays absent from DPS without changing issuer defaults; 000 is rejected (E0314/E0315)", () => {
  const withoutMunicipalCode = { ...draft, municipalServiceCode: "" };
  assert.deepEqual(
    draftIssues(config, withoutMunicipalCode, new Date("2026-11-13")),
    [],
  );
  const xml = buildDps(
    config,
    withoutMunicipalCode,
    1,
    "5",
    "2026-11-13T16:00:00Z",
  );
  engine.validate(xml);
  assert.match(xml, /<cTribNac>170101<\/cTribNac>/);
  assert.doesNotMatch(xml, /<cTribMun>/);
  assert.equal(config.settings.municipalServiceCode, "021");
  assert.equal(draft.municipalServiceCode, "021");
  assert.throws(
    () =>
      buildDps(
        config,
        { ...draft, municipalServiceCode: "000" },
        1,
        "6",
        "2026-11-13T16:00:00Z",
      ),
    /000 não é permitido/,
  );
});
test("CNC-confirmed absence omits IM in a newly signed XSD-valid DPS without changing the stored issuer (E0120)", () => {
  const decision = resolveIssuerRegistration(
    {
      status: 404,
      data: {
        TipoAmbiente: "HOMOLOGACAO",
        StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO",
        Erros: [],
      },
    },
    config.issuer,
    "2026-11-13",
  );
  const xml = buildDps(
    config,
    { ...draft, municipalServiceCode: "", serviceMunicipalityCode: "3551603" },
    1,
    "7",
    "2026-11-13T17:00:00Z",
    decision,
  );
  assert.doesNotMatch(xml, /<IM>/);
  assert.match(xml, /<cLocPrestacao>3551603<\/cLocPrestacao>/);
  assert.equal(config.issuer.municipalRegistration, "3220285");
  engine.validate(xml);
  const fixture = certificateFixture(),
    p12 = forge.pkcs12.pkcs12FromAsn1(fixture.asn, testPassword),
    bag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ][0];
  const signed = engine.sign(
    xml,
    forge.pki.privateKeyToPem(bag.key),
    forge.pki.certificateToPem(fixture.cert),
  );
  engine.validate(signed);
  assert.doesNotMatch(signed, /<IM>/);
});
