import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import {
  readNfseMirror,
  createNfseMirrorPdf,
  nfseMirrorNotice,
} from "../src/lib/nfseMirror.ts";
const expected = { accessKey: "2".repeat(50), dpsId: "DPS" + "3".repeat(42) };
export const mirrorFixture = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${expected.accessKey}"><xLocEmi>Santos/SP</xLocEmi><xLocPrestacao>Serra Negra/SP</xLocPrestacao><nNFSe>6</nNFSe><xLocIncid>Santos/SP</xLocIncid><dhProc>2026-11-13T15:00:01-03:00</dhProc><emit><CNPJ>60371448000143</CNPJ><xNome>PRESTADOR SINTETICO</xNome><enderNac><xLgr>RUA TESTE</xLgr><nro>1</nro><CEP>11045002</CEP></enderNac></emit><valores><vLiq>1.00</vLiq></valores><DPS><infDPS Id="${expected.dpsId}"><tpAmb>2</tpAmb><dhEmi>2026-11-13T15:00:00-03:00</dhEmi><serie>00001</serie><nDPS>6</nDPS><dCompet>2026-11-13</dCompet><prest><CNPJ>60371448000143</CNPJ><regTrib><opSimpNac>3</opSimpNac></regTrib></prest><toma><CPF>52998224725</CPF><xNome>CLIENTE SINTETICO</xNome><end><endNac><CEP>13930000</CEP></endNac><xLgr>RUA TESTE</xLgr><nro>1</nro></end></toma><serv><cServ><cTribNac>170101</cTribNac><cNBS>114011100</cNBS><xDescServ>Servico sintetico &amp; conferência</xDescServ></cServ></serv><valores><vServPrest><vServ>1.00</vServ></vServPrest><trib><tribMun><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores></infDPS></DPS></infNFSe></NFSe>`;
const parse = (text) =>
  new DOMParser().parseFromString(text, "application/xml");
test("mirror reads the authorized national XML with its own immutable values and labels missing amounts instead of inventing taxes", () => {
  const m = readNfseMirror(mirrorFixture, expected, parse);
  assert.equal(m.serviceCity, "Serra Negra/SP");
  assert.equal(m.issuer.name, "PRESTADOR SINTETICO");
  assert.equal(m.customer.name, "CLIENTE SINTETICO");
  assert.equal(m.description, "Servico sintetico & conferência");
  assert.equal(m.amount, "1.00");
  assert.equal(m.netAmount, "1.00");
  assert.equal(m.retainedAmount, "");
  assert.equal(m.municipalCode, "");
  assert.equal(m.simplesRate, "6.00");
  assert.match(m.notice, /não substitui o DANFSe oficial/);
});
test("mirror refuses another key, DPS, issuer, environment, duplicate nodes, namespaces, raw DPS, entities and excessive XML", () => {
  for (const xml of [
    mirrorFixture.replace("NFS" + expected.accessKey, "NFS" + "4".repeat(50)),
    mirrorFixture.replace(expected.dpsId, "DPS" + "4".repeat(42)),
    mirrorFixture.replace("<tpAmb>2", "<tpAmb>1"),
    mirrorFixture.replaceAll("60371448000143", "00000000000000"),
    mirrorFixture.replace(
      "http://www.sped.fazenda.gov.br/nfse",
      "https://wrong.test",
    ),
    mirrorFixture.replace("</DPS>", "</DPS><DPS/>"),
    '<DPS xmlns="http://www.sped.fazenda.gov.br/nfse"/>',
    '<!DOCTYPE NFSe SYSTEM="file:///private">' + mirrorFixture,
    " ".repeat(2 * 1024 * 1024 + 1),
  ])
    assert.throws(
      () => readNfseMirror(xml, expected, parse),
      /não corresponde/,
    );
});
test("mirror PDF is explicitly a conference copy and not an official DANFSe", async () => {
  const blob = await createNfseMirrorPdf(
    readNfseMirror(mirrorFixture, expected, parse),
  );
  assert.equal(blob.type, "application/pdf");
  const text = await blob.text();
  assert.ok(text.startsWith("%PDF-"));
  assert.match(text, /Espelho/);
  assert.match(text, /SEM VALIDADE FISCAL/);
  assert.match(nfseMirrorNotice, /não substitui/);
});
