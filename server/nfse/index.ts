import http from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import forge from "node-forge";
import { createClient } from "@supabase/supabase-js";
import * as PKI from "pkijs";
import * as ASN1 from "asn1js";
import * as libxml from "libxml2-wasm";
import { SignedXml } from "xml-crypto";
import { createFiscalHandler } from "../../supabase/functions/_shared/nfse-fiscal/handler.ts";
import { FiscalError } from "../../supabase/functions/_shared/nfse-fiscal/model.ts";
import { createRevocationChecker } from "../../supabase/functions/_shared/nfse-fiscal/revocation.ts";
import { createXmlEngine } from "../../supabase/functions/_shared/nfse-fiscal/xml.ts";
import { nodeNationalTransport } from "./https.ts";
import {
  createFiscalAuthentication,
  validateFiscalServerAccess,
} from "./auth.ts";
const env = process.env;
for (const name of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NFSE_CERTIFICATE_KEYS",
  "NFSE_ICP_ROOTS_PEM_B64",
  "NFSE_ALLOWED_ORIGINS",
])
  if (!env[name]) throw new Error(`Configuração fiscal ausente: ${name}`);
const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await validateFiscalServerAccess(admin);
PKI.setEngine(
  "webcrypto",
  new PKI.CryptoEngine({
    name: "webcrypto",
    crypto: globalThis.crypto,
    subtle: globalThis.crypto.subtle,
  }),
);
const schemas: Record<string, string> = {};
for (const name of [
  "DPS_v1.01.xsd",
  "tiposComplexos_v1.01.xsd",
  "tiposSimples_v1.01.xsd",
  "xmldsig-core-schema.xsd",
])
  schemas[name] = await readFile(
    new URL(
      "../../supabase/functions/nfse-fiscal/schemas/" + name,
      import.meta.url,
    ),
    "utf8",
  );
const xml = createXmlEngine({ ...libxml, SignedXml }, schemas);
const handler = createFiscalHandler({
  origins: env
    .NFSE_ALLOWED_ORIGINS!.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  keys: JSON.parse(env.NFSE_CERTIFICATE_KEYS!),
  rootsPem: Buffer.from(env.NFSE_ICP_ROOTS_PEM_B64!, "base64").toString("utf8"),
  authenticate: createFiscalAuthentication(admin),
  rpc: async (name, params) => {
    const { data, error } = await admin.rpc(name, params);
    if (!error) return data;
    if (error.code === "42501")
      throw new FiscalError("FORBIDDEN", "Acesso fiscal não autorizado.", 403);
    if (error.message.includes("NFSE_CONFLICT"))
      throw new FiscalError(
        "CONFLICT",
        "Os dados mudaram. Atualize o histórico antes de continuar.",
        409,
      );
    if (error.message.includes("NFSE_DRAFT_LOCKED"))
      throw new FiscalError(
        "DRAFT_LOCKED",
        "A DPS está protegida contra alteração. Consulte o histórico.",
        409,
      );
    if (error.message.includes("NFSE_CERTIFICATE_CHANGED"))
      throw new FiscalError(
        "CERTIFICATE_CHANGED",
        "O A1 mudou após o preparo da DPS.",
        409,
      );
    throw new FiscalError(
      "DATABASE_UNAVAILABLE",
      "O serviço não concluiu a gravação ou a migração está pendente. Atualize o histórico.",
      503,
    );
  },
  revocation: createRevocationChecker({
    forge,
    PKI,
    ASN1,
    fetcher: fetch,
    allowedHosts: (env.NFSE_CRL_ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }),
  transport: nodeNationalTransport(),
  sign: xml.sign,
  verifyResult: xml.verifyResult,
});
const host = env.NFSE_NODE_HOST || "127.0.0.1",
  port = Number(env.PORT || env.NFSE_NODE_PORT || 8789);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Porta fiscal inválida.");
const server = http.createServer(
  { maxHeaderSize: 16384, requestTimeout: 120000 },
  async (incoming, outgoing) => {
    try {
      if (incoming.method === "GET" && incoming.url === "/health") {
        outgoing.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        outgoing.end(
          JSON.stringify({
            status: "ok",
            environment: 2,
            productionEnabled: false,
            authConfigured: true,
          }),
        );
        return;
      }
      if (incoming.url !== "/nfse-fiscal") {
        outgoing.writeHead(404);
        outgoing.end();
        return;
      }
      const headers = new Headers();
      for (const key of [
        "authorization",
        "origin",
        "apikey",
        "content-type",
        "content-length",
      ]) {
        const value = incoming.headers[key];
        if (typeof value === "string") headers.set(key, value);
      }
      const request = new Request(`http://127.0.0.1:${port}/nfse-fiscal`, {
        method: incoming.method,
        headers,
        ...(["GET", "HEAD", "OPTIONS"].includes(incoming.method || "GET")
          ? {}
          : { body: Readable.toWeb(incoming), duplex: "half" }),
      } as RequestInit);
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as any).pipe(outgoing);
      else outgoing.end();
    } catch {
      if (!outgoing.headersSent)
        outgoing.writeHead(503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      outgoing.end(
        JSON.stringify({
          code: "FISCAL_UNAVAILABLE",
          error:
            "O serviço fiscal não concluiu a operação. Consulte o histórico antes de repetir.",
        }),
      );
    }
  },
);
server.listen(port, host, () =>
  console.log(`NFS-e em homologação: http://${host}:${port}/nfse-fiscal`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      xml.dispose();
      process.exit(0);
    }),
  );
