import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  createNationalTransport,
  nationalEligibility,
  nationalErrors,
  dpsNotFound,
  nationalHttpClientOptions,
} from "../supabase/functions/_shared/nfse-fiscal/transport.ts";
test("national transport pins sandbox hosts, routes municipal parameters separately and refuses production XML", async () => {
  const calls = [];
  let closed = false;
  const open = createNationalTransport({
    createClient: () => ({
      close: () => {
        closed = true;
      },
    }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response('{"ok":true}', {
        headers: { "Content-Type": "application/json" },
      });
    },
    gzip: (text) => gzipSync(text).toString("base64"),
    gunzip: (text) => gunzipSync(Buffer.from(text, "base64")).toString("utf8"),
  });
  const client = open("SYNTHETIC CERT", "SYNTHETIC KEY");
  await client.query("/parametros_municipais/3548500/convenio");
  await client.query(
    "/parametros_municipais/3548500/17.01.01.021/2026-11-13T00:00:00/aliquota",
  );
  await client.submit("<DPS><tpAmb>2</tpAmb></DPS>");
  await client.query("/cnc/3548500/60371448000143");
  assert.equal(
    calls[3].url,
    "https://adn.producaorestrita.nfse.gov.br/cnc/consulta/cad?codMunicipio=3548500&inscricaoFederal=60371448000143",
  );
  assert.equal(calls[3].options.method, "GET");
  await assert.rejects(
    client.query("/cnc/3548500/00000000000000"),
    (e) => e.code === "INVALID_ROUTE",
  );
  assert.equal(
    calls[0].url,
    "https://adn.producaorestrita.nfse.gov.br/parametrizacao/3548500/convenio",
  );
  assert.match(
    calls[2].url,
    /producaorestrita\.nfse\.gov\.br\/API\/SefinNacional\/nfse$/,
  );
  assert.equal(calls[2].options.redirect, "error");
  assert.match(
    gunzipSync(
      Buffer.from(JSON.parse(calls[2].options.body).dpsXmlGZipB64, "base64"),
    ).toString(),
    /<tpAmb>2/,
  );
  assert.throws(
    () => client.submit("<tpAmb>1</tpAmb>"),
    (e) => e.code === "PRODUCTION_DISABLED",
  );
  await assert.rejects(
    client.query("/nfse/../../production"),
    (e) => e.code === "INVALID_ROUTE",
  );
  await assert.rejects(
    client.query("https://evil.test"),
    (e) => e.code === "INVALID_ROUTE",
  );
  client.close();
  assert.equal(closed, true);
  assert.equal(calls.length, 4);
  assert.equal(
    nationalEligibility({ parametrosConvenio: { aderenteEmissorNacional: 1 } }),
    true,
  );
  assert.equal(
    nationalEligibility({ parametrosConvenio: { aderenteEmissorNacional: 0 } }),
    false,
  );
  assert.equal(nationalEligibility({ different: true }), null);
  assert.deepEqual(
    nationalErrors({
      erros: [{ Codigo: "E001", Descricao: "<script>unsafe</script> Invalid" }],
    }),
    [{ code: "E001", message: "unsafe Invalid" }],
  );
});
test("lookup recovery requires the exact national not-found code, never a generic 404 or production response", () => {
  assert.equal(
    dpsNotFound({
      status: 404,
      data: {
        tipoAmbiente: 0,
        erro: { codigo: "E2404", descricao: "Não foi gerada NFS-e" },
      },
    }),
    true,
  );
  for (const result of [
    { status: 404, data: {} },
    { status: 404, data: { erro: { codigo: "E9999" } } },
    { status: 500, data: { erro: { codigo: "E2404" } } },
    { status: 404, data: { tipoAmbiente: 1, erro: { codigo: "E2404" } } },
  ])
    assert.equal(dpsNotFound(result), false);
  const options = nationalHttpClientOptions("TEST CERT", "TEST KEY");
  assert.equal(options.http1, true);
  assert.equal(options.http2, false);
  assert.equal("unsafelyIgnoreCertificateErrors" in options, false);
});
test("official PDF lookup never turns an HTTP 404 or non-PDF into a successful download", async () => {
  let response = new Response(null, { status: 404 }),
    count = 0;
  const transport = createNationalTransport({
    createClient: () => ({ close() {} }),
    fetch: async () => {
      count++;
      return response;
    },
    gzip: () => "",
    gunzip: () => "",
  })("CERT", "KEY");
  await assert.rejects(
    transport.pdf("2".repeat(50)),
    (e) => e.code === "PDF_UNAVAILABLE",
  );
  response = new Response("<html>Unavailable</html>", { status: 200 });
  await assert.rejects(
    transport.pdf("2".repeat(50)),
    (e) => e.code === "PDF_UNAVAILABLE",
  );
  response = new Response("%PDF-1.7 SYNTHETIC", {
    headers: { "Content-Type": "application/pdf" },
  });
  const result = await transport.pdf("2".repeat(50));
  assert.equal(new TextDecoder().decode(result.pdf), "%PDF-1.7 SYNTHETIC");
  assert.equal(count, 3);
  transport.close();
});
