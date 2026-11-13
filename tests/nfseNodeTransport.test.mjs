import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { nodeNationalTransport } from "../server/nfse/https.ts";
import { createFiscalHandler } from "../supabase/functions/_shared/nfse-fiscal/handler.ts";
test("Node transport keeps TLS verification, HTTPS allowlist and UTF-8 body length, and never retries a POST", async () => {
  const calls = [];
  const transport = nodeNationalTransport((url, options, callback) => {
    const call = { url: String(url), options, body: "" };
    calls.push(call);
    const request = new EventEmitter();
    request.write = (body) => {
      call.body += body;
    };
    request.end = () =>
      queueMicrotask(() => {
        const response = Readable.from([
          Buffer.from(
            JSON.stringify({ tipoAmbiente: 2, erro: { codigo: "E2404" } }),
          ),
        ]);
        response.statusCode = 404;
        response.headers = { "content-type": "application/json" };
        callback(response);
      });
    return request;
  })("SYNTHETIC CERT", "SYNTHETIC KEY");
  const result = await transport.query("/dps/DPS" + "2".repeat(42));
  assert.equal(result.status, 404);
  assert.equal(calls.length, 1);
  await transport.submit(
    "<DPS><tpAmb>2</tpAmb><description>á</description></DPS>",
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(
    Number(calls[1].options.headers["Content-Length"]),
    Buffer.byteLength(calls[1].body),
  );
  assert.equal(calls[1].options.agent.options.rejectUnauthorized, true);
  assert.equal(calls[1].options.agent.options.minVersion, "TLSv1.2");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  await assert.rejects(transport.query("https://evil.test/private"));
  assert.equal(calls.length, 2);
  transport.close();
});
test("a runtime without compatible transmission rejects before reserving or sending another DPS", async () => {
  let calls = 0;
  const handler = createFiscalHandler({
    origins: ["https://local.test"],
    transmissionAvailable: false,
    authenticate: async () => ({
      id: crypto.randomUUID(),
      role: "master",
      allowedUnits: [],
      hiddenScreens: [],
    }),
    rpc: async () => {
      calls++;
      throw new Error("unexpected write");
    },
  });
  const response = await handler(
    new Request("https://local.test/nfse-fiscal", {
      method: "POST",
      headers: {
        origin: "https://local.test",
        authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "send",
        environment: 2,
        id: crypto.randomUUID(),
      }),
    }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "COMPATIBLE_SERVICE_REQUIRED");
  assert.equal(calls, 0);
});
test("a runtime without transmission reports its capability while keeping authenticated history readable", async () => {
  const handler = createFiscalHandler({
    origins: ["https://local.test"],
    transmissionAvailable: false,
    authenticate: async () => ({
      id: crypto.randomUUID(),
      role: "master",
      allowedUnits: [],
      hiddenScreens: [],
    }),
    rpc: async (name) => {
      assert.equal(name, "nfse_fiscal_load");
      return {
        environment: 2,
        productionEnabled: false,
        drafts: [],
        emissions: [],
      };
    },
  });
  const response = await handler(
    new Request("https://local.test/nfse-fiscal", {
      headers: { origin: "https://local.test", authorization: "Bearer test" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).transmissionAvailable, false);
});
