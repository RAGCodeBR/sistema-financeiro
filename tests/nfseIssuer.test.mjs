import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyNfseWorkspace } from "../src/lib/nfseDrafts.ts";
import {
  resolveIssuerRegistration,
  assertDpsIssuerRegistration,
} from "../supabase/functions/_shared/nfse-fiscal/issuer.ts";
const { issuer } = emptyNfseWorkspace();
const absent = () => ({
  status: 404,
  data: {
    TipoAmbiente: "HOMOLOGACAO",
    StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO",
    Erros: [],
  },
});
const present = () => ({
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
          Inscricao: "60371448000143",
          TpInscricao: "CNPJ",
          InscricaoMunicipal: "3220285",
          SituacaoEmissaoNFSe: "HABILITADO",
          DataApenasInicioInscricaoMunicipal: "2025-01-01",
        },
      },
    ],
  },
});
test("only a confirmed national CNC absence permits omission; the stored IM remains preserved", () => {
  const d = resolveIssuerRegistration(absent(), issuer, "2026-11-13");
  assert.equal(d.municipalRegistration, null);
  assert.equal(issuer.municipalRegistration, "3220285");
  assert.doesNotThrow(() =>
    assertDpsIssuerRegistration(
      "<DPS><prest><CNPJ>60371448000143</CNPJ></prest></DPS>",
      d,
    ),
  );
  assert.throws(
    () =>
      assertDpsIssuerRegistration(
        "<DPS><prest><IM>3220285</IM></prest></DPS>",
        d,
      ),
    (e) => e.code === "CNC_CHANGED",
  );
  for (const result of [
    { status: 404, data: {} },
    { ...absent(), status: 403 },
    { ...absent(), status: 500 },
    { status: 404, data: { ...absent().data, TipoAmbiente: "PRODUCAO" } },
    { status: 404, data: { ...absent().data, Erros: [{ Codigo: "E3317" }] } },
    { status: 404, data: { ...absent().data, ListaCadastroMunicipal: [{}] } },
  ])
    assert.throws(
      () => resolveIssuerRegistration(result, issuer, "2026-11-13"),
      (e) => e.code === "CNC_UNCONFIRMED",
    );
});
test("CNC inclusion requires this issuer, municipality, unique configured registration, authorization and valid competence", () => {
  const d = resolveIssuerRegistration(present(), issuer, "2026-11-13");
  assert.equal(d.municipalRegistration, "3220285");
  assert.doesNotThrow(() =>
    assertDpsIssuerRegistration(
      "<DPS><prest><IM>3220285</IM></prest></DPS>",
      d,
    ),
  );
  assert.throws(
    () => assertDpsIssuerRegistration("<DPS><prest></prest></DPS>", d),
    (e) => e.code === "CNC_CHANGED",
  );
  for (const change of [
    { Inscricao: "00000000000000" },
    { TpInscricao: "CPF" },
    { InscricaoMunicipal: "OTHER" },
    { SituacaoEmissaoNFSe: "NAO_HABILITADO" },
    { DataApenasInicioInscricaoMunicipal: "2026-11-14" },
    { DataApenasInicioInscricaoMunicipal: null },
  ]) {
    const r = present();
    Object.assign(r.data.ListaCadastroMunicipal[0].InfCad, change);
    assert.throws(() => resolveIssuerRegistration(r, issuer, "2026-11-13"));
  }
  for (const change of [
    { TipoAmbiente: "PRODUCAO" },
    { CodigoMunicipio: 3551603 },
    { OrigemDados: "RFB" },
  ]) {
    const r = present();
    Object.assign(r.data.ListaCadastroMunicipal[0], change);
    assert.throws(() => resolveIssuerRegistration(r, issuer, "2026-11-13"));
  }
  const duplicate = present();
  duplicate.data.ListaCadastroMunicipal.push(
    structuredClone(duplicate.data.ListaCadastroMunicipal[0]),
  );
  assert.throws(
    () => resolveIssuerRegistration(duplicate, issuer, "2026-11-13"),
    (e) => e.code === "CNC_IM_MISMATCH",
  );
});
