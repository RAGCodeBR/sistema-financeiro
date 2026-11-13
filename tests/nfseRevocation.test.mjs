import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import * as PKI from "pkijs";
import * as ASN1 from "asn1js";
import { compactCrl } from "../supabase/functions/_shared/nfse-fiscal/crl.ts";
import {
  createRevocationChecker,
  allowedCrlUrl,
} from "../supabase/functions/_shared/nfse-fiscal/revocation.ts";
PKI.setEngine(
  "webcrypto",
  new PKI.CryptoEngine({
    name: "webcrypto",
    crypto: globalThis.crypto,
    subtle: globalThis.crypto.subtle,
  }),
);
const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }),
  key = forge.pki.privateKeyFromPem(pair.privateKey);
const root = forge.pki.createCertificate();
root.serialNumber = "01";
root.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
root.validity.notBefore = new Date("2020-01-01");
root.validity.notAfter = new Date("2040-01-01");
root.setSubject([{ name: "commonName", value: "SYNTHETIC CRL ROOT" }]);
root.setIssuer(root.subject.attributes);
root.setExtensions([
  { name: "basicConstraints", cA: true, critical: true },
  { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
]);
root.sign(key, forge.md.sha256.create());
const leaf = forge.pki.createCertificate();
leaf.serialNumber = "02";
leaf.publicKey = root.publicKey;
leaf.validity.notBefore = new Date("2020-01-01");
leaf.validity.notAfter = new Date("2030-01-01");
leaf.setSubject([{ name: "commonName", value: "SYNTHETIC LEAF" }]);
leaf.setIssuer(root.subject.attributes);
const a = forge.asn1,
  uri = a.create(128, 6, false, "http://crl.example.test/root.crl"),
  dp = a.create(0, a.Type.SEQUENCE, true, [
    a.create(0, a.Type.SEQUENCE, true, [
      a.create(128, 0, true, [a.create(128, 0, true, [uri])]),
    ]),
  ]);
leaf.setExtensions([
  { name: "basicConstraints", cA: false },
  { id: "2.5.29.31", value: a.toDer(dp).getBytes() },
]);
leaf.sign(key, forge.md.sha256.create());
const rootPem = forge.pki.certificateToPem(root),
  leafPem = forge.pki.certificateToPem(leaf),
  issuer = PKI.Certificate.fromBER(
    Buffer.from(
      forge.asn1.toDer(forge.pki.certificateToAsn1(root)).getBytes(),
      "binary",
    ),
  );
const privateKey = await crypto.subtle.importKey(
  "pkcs8",
  Buffer.from(pair.privateKey.replace(/-----[^-]+-----|\s/g, ""), "base64"),
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["sign"],
);
async function crl({
  revoked = false,
  expired = false,
  tampered = false,
  entries = 0,
} = {}) {
  const list = new PKI.CertificateRevocationList({
    version: 1,
    issuer: issuer.subject,
    thisUpdate: new PKI.Time({ type: 0, value: new Date("2026-11-12") }),
    nextUpdate: new PKI.Time({
      type: 0,
      value: new Date(expired ? "2026-11-12" : "2026-11-15"),
    }),
    revokedCertificates: entries
      ? Array.from(
          { length: entries },
          (_, i) =>
            new PKI.RevokedCertificate({
              userCertificate: new ASN1.Integer({ value: i + 10 }),
              revocationDate: new PKI.Time({
                type: 0,
                value: new Date("2026-11-12"),
              }),
            }),
        )
      : revoked
        ? [
            new PKI.RevokedCertificate({
              userCertificate: new ASN1.Integer({ value: 2 }),
              revocationDate: new PKI.Time({
                type: 0,
                value: new Date("2026-11-12"),
              }),
            }),
          ]
        : [],
  });
  await list.sign(privateKey, "SHA-256");
  const bytes = new Uint8Array(list.toSchema(true).toBER(false));
  if (tampered) bytes[bytes.length - 1] ^= 1;
  return bytes;
}
test("revocation verifies signed fresh CRL and rejects revoked, stale and tampered lists", async () => {
  for (const options of [
    {},
    { revoked: true },
    { expired: true },
    { tampered: true },
  ]) {
    const bytes = await crl(options),
      check = createRevocationChecker({
        forge,
        PKI,
        ASN1,
        allowedHosts: ["crl.example.test"],
        fetcher: async () => new Response(bytes),
      });
    if (Object.keys(options).length)
      await assert.rejects(
        check(leafPem, [], rootPem, new Date("2026-11-13")),
        (e) =>
          e.code ===
          (options.revoked ? "CERTIFICATE_REVOKED" : "CRL_UNAVAILABLE"),
      );
    else {
      const result = await check(leafPem, [], rootPem, new Date("2026-11-13"));
      assert.equal(result.status, "good");
      assert.equal(result.checks.length, 1);
      assert.equal(result.validUntil, "2026-11-13T00:05:00.000Z");
    }
  }
});
test("large signed CRLs are scanned completely while only small metadata is decoded by PKIjs", async () => {
  const bytes = await crl({ entries: 25000 });
  const compact = compactCrl(bytes, "02");
  assert.equal(compact.revoked, false);
  assert.ok(compact.compact.length < 2000);
  assert.ok(bytes.length > 400000);
  assert.equal(compactCrl(bytes, (25009).toString(16)).revoked, true);
  let decoded = 0;
  const check = createRevocationChecker({
    forge,
    PKI,
    ASN1: {
      ...ASN1,
      fromBER: (data, options) => {
        decoded = Math.max(decoded, data.byteLength);
        return ASN1.fromBER(data, options);
      },
    },
    allowedHosts: ["crl.example.test"],
    fetcher: async () => new Response(bytes),
  });
  assert.equal(
    (await check(leafPem, [], rootPem, new Date("2026-11-13"))).status,
    "good",
  );
  assert.ok(decoded < 2000);
  const tampered = bytes.slice();
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    createRevocationChecker({
      forge,
      PKI,
      ASN1,
      allowedHosts: ["crl.example.test"],
      fetcher: async () => new Response(tampered),
    })(leafPem, [], rootPem, new Date("2026-11-13")),
    (e) => e.code === "CRL_UNAVAILABLE",
  );
  const changedTbs = bytes.slice(),
    firstEntry = Buffer.from(bytes).indexOf(
      Buffer.from([48, 18, 2, 1, 10, 23, 13]),
    );
  assert.ok(firstEntry > 0);
  changedTbs[firstEntry + 4] = 11;
  await assert.rejects(
    createRevocationChecker({
      forge,
      PKI,
      ASN1,
      allowedHosts: ["crl.example.test"],
      fetcher: async () => new Response(changedTbs),
    })(leafPem, [], rootPem, new Date("2026-11-13")),
    (e) => e.code === "CRL_UNAVAILABLE",
  );
  for (const invalid of [
    bytes.slice(0, -1),
    new Uint8Array([...bytes, 0]),
    new Uint8Array([48, 128, 0, 0]),
  ])
    assert.throws(() => compactCrl(invalid, "02"));
});
test("CRL URL allowlist blocks internal addresses, credentials, alternate ports and redirects", async () => {
  for (const url of [
    "http://127.0.0.1/x",
    "http://169.254.169.254/x",
    "file:///secret",
    "http://user:pass@acraiz.icpbrasil.gov.br/x",
    "https://acraiz.icpbrasil.gov.br:8443/x",
    "https://acraiz.icpbrasil.gov.br.evil.test/x",
  ])
    assert.throws(() => allowedCrlUrl(url));
  const check = createRevocationChecker({
    forge,
    PKI,
    ASN1,
    allowedHosts: ["crl.example.test"],
    fetcher: async (url, opts) => {
      assert.equal(opts.redirect, "error");
      return new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/" },
      });
    },
  });
  await assert.rejects(
    check(leafPem, [], rootPem, new Date("2026-11-13")),
    (e) => e.code === "CRL_UNAVAILABLE",
  );
});
