import forge from "npm:node-forge@1.4.3";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import * as libxml from "npm:libxml2-wasm@0.7.2";
import { SignedXml } from "npm:xml-crypto@6.4.0";
import * as PKI from "npm:pkijs@4.0.1";
import * as ASN1 from "npm:asn1js@4.0.0";
import { gzipSync, gunzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { createFiscalHandler } from "../_shared/nfse-fiscal/handler.ts";
import { FiscalError } from "../_shared/nfse-fiscal/model.ts";
import { createXmlEngine } from "../_shared/nfse-fiscal/xml.ts";
import {
  createNationalTransport,
  nationalHttpClientOptions,
} from "../_shared/nfse-fiscal/transport.ts";
import { createRevocationChecker } from "../_shared/nfse-fiscal/revocation.ts";

let keys: Record<string, string> = {};
try {
  keys = JSON.parse(Deno.env.get("NFSE_CERTIFICATE_KEYS") || "{}");
} catch {
  /* fail closed */
}
let rootsPem = "";
try {
  rootsPem = atob(Deno.env.get("NFSE_ICP_ROOTS_PEM_B64") || "");
} catch {
  /* fail closed */
}
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
  schemas[name] = await Deno.readTextFile(
    new URL(`./schemas/${name}`, import.meta.url),
  );
const xml = createXmlEngine({ ...libxml, SignedXml }, schemas);
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const transport = createNationalTransport({
  createClient: (cert, key) =>
    Deno.createHttpClient(nationalHttpClientOptions(cert, key)),
  fetch: (url, options) => fetch(url, options),
  gzip: (text) => gzipSync(Buffer.from(text, "utf8")).toString("base64"),
  gunzip: (base64) =>
    gunzipSync(Buffer.from(base64, "base64"), {
      maxOutputLength: 2 * 1024 * 1024,
    }).toString("utf8"),
});
const directHandler = createFiscalHandler({
  transmissionAvailable: false,
  origins: (
    Deno.env.get("NFSE_ALLOWED_ORIGINS") || "https://ragcodebr.github.io"
  )
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
  keys,
  rootsPem,
  authenticate: async (token) => {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,allowed_units,hidden_screens")
      .eq("id", data.user.id)
      .single();
    return profileError || !profile
      ? null
      : {
          id: profile.id,
          role: profile.role,
          allowedUnits: profile.allowed_units || [],
          hiddenScreens: profile.hidden_screens || [],
        };
  },
  rpc: async (name, params) => {
    const { data, error } = await admin.rpc(name, params);
    if (!error) return data;
    if (error.code === "42501")
      throw new FiscalError("FORBIDDEN", "Acesso fiscal não autorizado.", 403);
    if (error.message.includes("NFSE_CONFLICT"))
      throw new FiscalError(
        "CONFLICT",
        "Os dados foram alterados em outra sessão. Atualize a tela antes de continuar.",
        409,
      );
    if (error.message.includes("NFSE_DRAFT_LOCKED"))
      throw new FiscalError(
        "DRAFT_LOCKED",
        "Este rascunho possui uma DPS preparada ou enviada e não pode ser alterado. Consulte o histórico.",
        409,
      );
    if (error.message.includes("NFSE_CERTIFICATE_CHANGED"))
      throw new FiscalError(
        "CERTIFICATE_CHANGED",
        "O A1 foi alterado. Descarte a DPS que ainda não foi enviada e prepare uma nova revisão.",
        409,
      );
    throw new FiscalError(
      "DATABASE_UNAVAILABLE",
      "O armazenamento fiscal está indisponível ou a migração ainda não foi ativada.",
      503,
    );
  },
  revocation: createRevocationChecker({
    forge,
    PKI,
    ASN1,
    fetcher: fetch,
    allowedHosts: (Deno.env.get("NFSE_CRL_ALLOWED_HOSTS") || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  }),
  transport,
  sign: xml.sign,
  verifyResult: xml.verifyResult,
});
const relayUrl = Deno.env.get("NFSE_NODE_SERVICE_URL") || "";
if (
  relayUrl &&
  (new URL(relayUrl).protocol !== "https:" ||
    new URL(relayUrl).pathname !== "/nfse-fiscal" ||
    new URL(relayUrl).username ||
    new URL(relayUrl).password ||
    new URL(relayUrl).hash ||
    new URL(relayUrl).search)
)
  throw new Error("Invalid fiscal service URL");
Deno.serve(async (request) => {
  if (!relayUrl) return directHandler(request);
  const origin = request.headers.get("origin") || "";
  const allowed = (
    Deno.env.get("NFSE_ALLOWED_ORIGINS") || "https://ragcodebr.github.io"
  )
    .split(",")
    .map((s) => s.trim())
    .includes(origin);
  if (!allowed)
    return Response.json(
      { code: "ORIGIN_DENIED", error: "Origem não autorizada." },
      { status: 403 },
    );
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  const forwardHeaders = new Headers();
  for (const key of ["authorization", "apikey", "content-type", "origin"]) {
    const value = request.headers.get(key);
    if (value) forwardHeaders.set(key, value);
  }
  try {
    return await fetch(relayUrl, {
      method: request.method,
      headers: forwardHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(110000),
      ...(["GET", "HEAD", "OPTIONS"].includes(request.method)
        ? {}
        : { body: request.body, duplex: "half" }),
    });
  } catch {
    return Response.json(
      {
        code: "FISCAL_SERVICE_UNAVAILABLE",
        error:
          "O serviço de emissão está indisponível. Consulte o histórico antes de repetir um envio.",
      },
      { status: 503, headers: cors },
    );
  }
});
