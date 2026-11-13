import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import forge from "node-forge";
import { createFiscalHandler } from "../supabase/functions/_shared/nfse-fiscal/handler.ts";
import {
  cleanDraft,
  FiscalError,
} from "../supabase/functions/_shared/nfse-fiscal/model.ts";
import {
  sealCertificate,
  base64,
} from "../supabase/functions/_shared/nfse-certificate/crypto.ts";
import { validateCertificate } from "../supabase/functions/_shared/nfse-certificate/validate.ts";
import {
  certificateFixture,
  rootPem,
  testPassword,
} from "./helpers/nfseCertificateFixtures.mjs";
let db, handler;
const master = "11111111-1111-4111-8111-111111111111",
  operator = "22222222-2222-4222-8222-222222222222",
  issuer = "60371448000143";
const rpc = async (name, args) => {
  const keys = Object.keys(args);
  try {
    return (
      await db.query(
        `select public.${name}(${keys.map((key, i) => key + "=> $" + (i + 1)).join(",")}) result`,
        keys.map((key) =>
          typeof args[key] === "object" && args[key] !== null
            ? JSON.stringify(args[key])
            : args[key],
        ),
      )
    ).rows[0].result;
  } catch (e) {
    if (/CONFLICT/.test(e.message))
      throw new FiscalError("CONFLICT", "Conflito", 409);
    throw e;
  }
};
let submitted = 0,
  mode = "timeout",
  cncMode = "absent",
  revocationError = false;
const requests = [];
const invoke = async (
  body,
  token = "master",
  origin = "https://local.test",
) => {
  const r = await handler(
    new Request("https://test/functions/v1/nfse-fiscal", {
      method: body ? "POST" : "GET",
      headers: {
        origin,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return { status: r.status, data: await r.json() };
};
const complete = () =>
  cleanDraft({
    id: crypto.randomUUID(),
    customerName: "SYNTHETIC CUSTOMER",
    customerDocument: "52998224725",
    serviceDate: "2026-11-01",
    description: "Synthetic service",
    amount: "100,00",
    customerPostalCode: "11045002",
    customerStreet: "RUA TESTE",
    customerNumber: "1",
    customerDistrict: "CENTRO",
    customerMunicipalityCode: "3548500",
    serviceMunicipalityCode: "3548500",
    serviceCode: "170101",
    municipalServiceCode: "021",
    nbsCode: "114011100",
    issWithheld: "nao",
    federalRetention: "nao",
  });
before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table profiles(id uuid primary key,role text,allowed_units text[],hidden_screens text[]);",
  );
  for (const f of [
    "20261112160000_nfse_certificate_vault.sql",
    "20261113180000_nfse_homologation.sql",
    "20261113210000_nfse_retry_after_lookup.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  await db.query("insert into auth.users values($1),($2)", [master, operator]);
  await db.query(
    "insert into profiles values($1,'master','{}','{}'),($2,'operador',array['__income_write__'],'{}')",
    [master, operator],
  );
  const fixture = certificateFixture(),
    validated = validateCertificate(
      forge,
      fixture.bytes,
      testPassword,
      issuer,
      rootPem,
    ),
    id = crypto.randomUUID(),
    key = crypto.getRandomValues(new Uint8Array(32)),
    keys = { test: base64(key) };
  const envelope = await sealCertificate(
    validated.secret,
    issuer,
    id,
    "test",
    key,
  );
  await rpc("nfse_certificate_save", {
    p_actor_id: master,
    p_issuer_cnpj: issuer,
    p_id: id,
    p_metadata: validated.metadata,
    p_envelope: envelope,
    p_expected_id: null,
  });
  handler = createFiscalHandler({
    origins: ["https://local.test"],
    keys,
    rootsPem: rootPem,
    authenticate: async (token) =>
      token === "master"
        ? { id: master, role: "master", allowedUnits: [], hiddenScreens: [] }
        : token === "operator"
          ? {
              id: operator,
              role: "operador",
              allowedUnits: ["__income_write__"],
              hiddenScreens: [],
            }
          : null,
    rpc,
    revocation: async () => {
      if (revocationError)
        throw new FiscalError(
          "CERTIFICATE_REVOKED",
          "Certificado revogado",
          403,
        );
      return {
        status: "good",
        checkedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 300000).toISOString(),
      };
    },
    sign: (xml) => xml,
    transport: () => ({
      query: async (path) => {
        requests.push(path);
        if (path.startsWith("/cnc/")) {
          if (cncMode === "unavailable") return { status: 503, data: {} };
          if (cncMode === "present")
            return {
              status: 200,
              data: {
                TipoAmbiente: "HOMOLOGACAO",
                StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
                Erros: [],
                ListaCadastroMunicipal: [
                  {
                    OrigemDados: "CNC",
                    TipoAmbiente: "HOMOLOGACAO",
                    CodigoMunicipio: 3548500,
                    InfCad: {
                      Inscricao: issuer,
                      TpInscricao: "CNPJ",
                      InscricaoMunicipal: "3220285",
                      SituacaoEmissaoNFSe: "HABILITADO",
                      DataApenasInicioInscricaoMunicipal: "2025-01-01",
                    },
                  },
                ],
              },
            };
          return {
            status: 404,
            data: {
              TipoAmbiente: "HOMOLOGACAO",
              StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO",
              Erros: [],
            },
          };
        }
        if (path.includes("49999") && path.startsWith("/dps/"))
          return {
            status: 404,
            data: {
              tipoAmbiente: 0,
              erro: { codigo: "E2404", descricao: "Não foi gerada NFS-e" },
            },
          };
        if (path.endsWith("convenio"))
          return {
            status: 200,
            data: { parametrosConvenio: { aderenteEmissorNacional: 1 } },
          };
        if (path.endsWith("aliquota"))
          if (path.includes("/17.01.01.000/"))
            return {
              status: 200,
              data: { aliquotas: { "17.01.01.000": [{ Aliq: 2 }] } },
            };
          else
            return {
              status: 404,
              data: { aliquotas: null, mensagem: "Alíquotas não encontradas." },
            };
        if (path.startsWith("/dps/"))
          if (mode === "not_found")
            return {
              status: 404,
              data: {
                tipoAmbiente: 0,
                erro: { codigo: "E2404", descricao: "Não foi gerada NFS-e" },
              },
            };
          else
            return {
              status: 200,
              data: { chaveAcesso: "2".repeat(50), tipoAmbiente: 2 },
            };
        return { status: 200, data: { nfseXmlGZipB64: "synthetic" } };
      },
      submit: async () => {
        submitted++;
        if (mode === "timeout") throw new Error("TIMEOUT");
        return {
          status: 400,
          data: {
            erros: [
              {
                Codigo: mode === "duplicate" ? "E0014" : "E_TEST",
                Descricao: "Rejeição sintética",
              },
            ],
          },
        };
      },
      unpack: () => "<NFSe>synthetic authorized response only for test</NFSe>",
      close: () => {},
    }),
    verifyResult: () => {},
  });
});
after(async () => db?.close());
test("fiscal HTTP requires origin, verified user and master for transmission, never accepts production", async () => {
  assert.equal((await invoke(null, "bad")).status, 401);
  assert.equal((await invoke(null, "master", "https://evil.test")).status, 403);
  assert.equal(
    (await invoke({ action: "connection" }, "operator")).status,
    403,
  );
  assert.equal((await invoke({ action: "send", environment: 1 })).status, 403);
  assert.equal(submitted, 0);
});
test("revoked certificate fails closed before any reservation or submission", async () => {
  revocationError = true;
  assert.equal((await invoke({ action: "connection" })).status, 403);
  revocationError = false;
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from nfse_private.fiscal_emissions",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(submitted, 0);
});
test("full sandbox workflow prepares once, survives uncertain submission and only consults thereafter", async () => {
  let s = (await invoke()).data;
  s.config.setupReviewed = true;
  s = (
    await invoke({
      action: "config",
      config: s.config,
      revision: s.configRevision,
    })
  ).data;
  const d = complete();
  s = (await invoke({ action: "draft", draft: d, revision: null })).data;
  let r = await invoke({
    action: "prepare",
    draftId: d.id,
    draftRevision: 1,
    configRevision: s.configRevision,
  });
  assert.equal(r.status, 200);
  s = r.data;
  const e = s.emissions[0];
  assert.equal(e.status, "prepared");
  assert.equal(e.environment, 2);
  assert.ok(requests.some((p) => p.includes("/17.01.01.021/")));
  assert.equal("signed_xml" in e, false);
  assert.equal("lease" in e, false);
  const repeated = await invoke({
    action: "prepare",
    draftId: d.id,
    draftRevision: 1,
    configRevision: s.configRevision,
  });
  assert.equal(repeated.data.emissions.length, 1);
  assert.equal((await invoke({ action: "send", id: e.id })).status, 422);
  assert.equal(submitted, 0);
  s = (
    await invoke({
      action: "send",
      id: e.id,
      confirmation: "ENVIAR HOMOLOGACAO",
    })
  ).data;
  assert.equal(s.emissions[0].status, "unknown");
  assert.equal(submitted, 1);
  await invoke({
    action: "send",
    id: e.id,
    confirmation: "ENVIAR HOMOLOGACAO",
  });
  assert.equal(submitted, 1);
  s = (await invoke({ action: "reconcile", id: e.id })).data;
  assert.equal(s.emissions[0].status, "authorized");
  assert.equal(submitted, 1);
  const xml = await invoke({ action: "xml", id: e.id });
  assert.match(xml.data.filename, /HOMOLOGACAO/);
  assert.equal("privateKeyPem" in xml.data, false);
});
test("incomplete customer blocks preparation before reserving another DPS", async () => {
  const d = complete();
  d.customerMunicipalityCode = "";
  const s = (await invoke({ action: "draft", draft: d })).data;
  const r = await invoke({
    action: "prepare",
    draftId: d.id,
    draftRevision: 1,
    configRevision: s.configRevision,
  });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /IBGE/);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from nfse_private.fiscal_emissions",
      )
    ).rows[0].n,
    1,
  );
});
test("national duplicate response requires consultation and never unlocks the draft for a new invoice", async () => {
  const draft = complete();
  let s = (await invoke({ action: "draft", draft })).data;
  s = (
    await invoke({
      action: "prepare",
      draftId: draft.id,
      draftRevision: 1,
      configRevision: s.configRevision,
    })
  ).data;
  const e = s.emissions.find((e) => e.draftId === draft.id);
  mode = "duplicate";
  const before = submitted;
  s = (
    await invoke({
      action: "send",
      id: e.id,
      confirmation: "ENVIAR HOMOLOGACAO",
    })
  ).data;
  assert.equal(s.emissions.find((n) => n.id === e.id).status, "unknown");
  assert.equal(submitted, before + 1);
  await assert.rejects(
    rpc("nfse_fiscal_draft_save", {
      p_actor_id: master,
      p_issuer_cnpj: issuer,
      p_id: draft.id,
      p_payload: draft,
      p_expected_revision: 1,
    }),
    /DRAFT_LOCKED/,
  );
  await invoke({
    action: "send",
    id: e.id,
    confirmation: "ENVIAR HOMOLOGACAO",
  });
  assert.equal(submitted, before + 1);
});
test("discarding an unsent prepared DPS requires confirmation and preserves its number", async () => {
  const draft = complete();
  let s = (await invoke({ action: "draft", draft })).data;
  s = (
    await invoke({
      action: "prepare",
      draftId: draft.id,
      draftRevision: 1,
      configRevision: s.configRevision,
    })
  ).data;
  const e = s.emissions.find((e) => e.draftId === draft.id);
  assert.equal((await invoke({ action: "discard", id: e.id })).status, 422);
  s = (
    await invoke({ action: "discard", id: e.id, confirmation: "DESCARTAR DPS" })
  ).data;
  assert.equal(s.emissions.find((n) => n.id === e.id).status, "discarded");
  s = (
    await invoke({
      action: "draft",
      draft: { ...draft, amount: "150,00" },
      revision: 1,
    })
  ).data;
  s = (
    await invoke({
      action: "prepare",
      draftId: draft.id,
      draftRevision: 2,
      configRevision: s.configRevision,
    })
  ).data;
  const next = s.emissions.find(
    (n) => n.draftId === draft.id && n.draftRevision === 2,
  );
  assert.equal(next.status, "prepared");
  assert.notEqual(next.number, e.number);
});
test("a recent authenticated E2404 lookup permits review of the same immutable DPS but never sends it automatically", async () => {
  const draft = complete();
  let s = (await invoke({ action: "draft", draft })).data;
  s = (
    await invoke({
      action: "prepare",
      draftId: draft.id,
      draftRevision: 1,
      configRevision: s.configRevision,
    })
  ).data;
  const e = s.emissions.find((e) => e.draftId === draft.id);
  mode = "timeout";
  await invoke({
    action: "send",
    id: e.id,
    confirmation: "ENVIAR HOMOLOGACAO",
  });
  const before = submitted;
  mode = "not_found";
  s = (await invoke({ action: "reconcile", id: e.id })).data;
  assert.equal(s.emissions.find((n) => n.id === e.id).errors[0].code, "E2404");
  const record = await rpc("nfse_fiscal_record", {
      p_actor_id: master,
      p_issuer_cnpj: issuer,
      p_id: e.id,
    }),
    proof = {
      p_actor_id: master,
      p_issuer_cnpj: issuer,
      p_id: e.id,
      p_lease: record.lease,
      p_checked_at: new Date().toISOString(),
      p_http_status: 404,
      p_national_code: "E2404",
    };
  for (const invalid of [
    { p_http_status: 200 },
    { p_national_code: "E9999" },
    { p_checked_at: "2020-01-01T00:00:00Z" },
  ])
    await assert.rejects(
      rpc("nfse_fiscal_resume", { ...proof, ...invalid }),
      /LOOKUP_REQUIRED/,
    );
  await assert.rejects(
    rpc("nfse_fiscal_resume", { ...proof, p_lease: null }),
    (e) => e.code === "CONFLICT",
  );
  assert.equal((await invoke({ action: "resume", id: e.id })).status, 422);
  assert.equal(
    (
      await invoke(
        { action: "resume", id: e.id, confirmation: "RETOMAR DPS" },
        "operator",
      )
    ).status,
    403,
  );
  s = (
    await invoke({ action: "resume", id: e.id, confirmation: "RETOMAR DPS" })
  ).data;
  const resumed = s.emissions.find((n) => n.id === e.id);
  assert.equal(resumed.status, "prepared");
  assert.equal(resumed.dpsId, e.dpsId);
  assert.equal(resumed.number, e.number);
  assert.equal(submitted, before);
});
test("blank municipal draft code queries national parameters without restoring issuer 021 or submitting a DPS", async () => {
  const draft = { ...complete(), municipalServiceCode: "" };
  let s = (await invoke({ action: "draft", draft })).data;
  const before = submitted,
    start = requests.length;
  const result = await invoke({
    action: "prepare",
    draftId: draft.id,
    draftRevision: 1,
    configRevision: s.configRevision,
  });
  assert.equal(result.status, 200);
  s = result.data;
  assert.ok(requests.slice(start).some((p) => p.includes("/17.01.01.000/")));
  assert.ok(!requests.slice(start).some((p) => p.includes("/17.01.01.021/")));
  const e = s.emissions.find((e) => e.draftId === draft.id);
  assert.equal(e.status, "prepared");
  assert.equal(s.config.settings.municipalServiceCode, "021");
  const stored = await rpc("nfse_fiscal_record", {
    p_actor_id: master,
    p_issuer_cnpj: issuer,
    p_id: e.id,
  });
  assert.doesNotMatch(stored.signed_xml, /<cTribMun>/);
  assert.doesNotMatch(stored.signed_xml, /<pAliq>/);
  assert.match(stored.signed_xml, /<pTotTribSN>6.00<\/pTotTribSN>/);
  assert.equal(submitted, before);
});
test("CNC controls IM in the signed DPS while leaving the issuer registration intact, and failures block before reservation", async () => {
  const draft = complete();
  let s = (await invoke({ action: "draft", draft })).data;
  const count = (
      await db.query(
        "select count(*)::int n from nfse_private.fiscal_emissions",
      )
    ).rows[0].n,
    before = submitted;
  try {
    cncMode = "unavailable";
    let r = await invoke({
      action: "prepare",
      draftId: draft.id,
      draftRevision: 1,
      configRevision: s.configRevision,
    });
    assert.equal(r.status, 503);
    assert.equal(r.data.code, "CNC_UNCONFIRMED");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from nfse_private.fiscal_emissions",
        )
      ).rows[0].n,
      count,
    );
    cncMode = "present";
    r = await invoke({
      action: "prepare",
      draftId: draft.id,
      draftRevision: 1,
      configRevision: s.configRevision,
    });
    assert.equal(r.status, 200);
    s = r.data;
    const e = s.emissions.find((e) => e.draftId === draft.id);
    const stored = await rpc("nfse_fiscal_record", {
      p_actor_id: master,
      p_issuer_cnpj: issuer,
      p_id: e.id,
    });
    assert.match(stored.signed_xml, /<IM>3220285<\/IM>/);
    assert.equal(s.config.issuer.municipalRegistration, "3220285");
    cncMode = "absent";
    r = await invoke({
      action: "send",
      id: e.id,
      confirmation: "ENVIAR HOMOLOGACAO",
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, "CNC_CHANGED");
    assert.equal(submitted, before);
    assert.equal(
      (
        await rpc("nfse_fiscal_record", {
          p_actor_id: master,
          p_issuer_cnpj: issuer,
          p_id: e.id,
        })
      ).status,
      "prepared",
    );
  } finally {
    cncMode = "absent";
  }
});
