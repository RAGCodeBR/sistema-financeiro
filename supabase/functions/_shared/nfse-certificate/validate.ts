import { CertificateError } from "./crypto.ts";

export const MAX_CERTIFICATE_BYTES = 512 * 1024;
// Forge is injected: the client application never imports the PKCS#12 parser.
// The Edge entrypoint pins npm:node-forge@1.4.3.
type Forge = any;
type Asn = {
  tagClass: number;
  type: number;
  constructed: boolean;
  value: string | Asn[];
};
const children = (node?: Asn): Asn[] =>
  node && Array.isArray(node.value) ? node.value : [];
const numericOid = (forge: Forge, node?: Asn): string =>
  node?.type === 6 && typeof node.value === "string"
    ? forge.asn1.derToOid(node.value)
    : "";
function boundedIterations(node?: Asn) {
  if (
    !node ||
    typeof node.value !== "string" ||
    !node.value.length ||
    node.value.length > 4 ||
    node.value.charCodeAt(0) & 128
  )
    throw new CertificateError(
      "UNSUPPORTED_PFX",
      "O arquivo usa parâmetros de proteção não suportados.",
    );
  let iterations = 0;
  for (const char of node.value)
    iterations = iterations * 256 + char.charCodeAt(0);
  if (iterations < 1 || iterations > 100000)
    throw new CertificateError(
      "UNSUPPORTED_PFX",
      "O arquivo usa parâmetros de proteção fora dos limites suportados. Exporte um novo A1 protegido por senha.",
    );
}
function inspectAsn1(forge: Forge, root: Asn) {
  let count = 0;
  const visit = (node: Asn, depth: number) => {
    if (++count > 20000 || depth > 48)
      throw new CertificateError(
        "INVALID_PFX",
        "O certificado tem uma estrutura não suportada.",
      );
    const values = children(node);
    if (values[0]?.type === 6) {
      const oid = numericOid(forge, values[0]);
      if (
        oid === "1.2.840.113549.1.5.12" ||
        /^1\.2\.840\.113549\.1\.12\.1\.\d+$/.test(oid)
      )
        boundedIterations(children(values[1])[1]);
    }
    for (const value of values) visit(value, depth + 1);
    // AuthenticatedSafe is DER nested inside an OCTET STRING. Inspect KDF
    // parameters there before Forge performs password derivation.
    if (
      node.type === 4 &&
      typeof node.value === "string" &&
      node.value.charCodeAt(0) === 0x30
    ) {
      try {
        visit(
          forge.asn1.fromDer(node.value, {
            strict: true,
            parseAllBytes: true,
            maxDepth: 48,
          }),
          depth + 1,
        );
      } catch (error) {
        if (error instanceof CertificateError) throw error;
      }
    }
  };
  visit(root, 0);
  const mac = children(root)[2];
  if (!mac)
    throw new CertificateError(
      "INVALID_PFX",
      "O arquivo precisa ter verificação de integridade e proteção por senha.",
    );
  const iterations = children(mac)[2];
  if (iterations) boundedIterations(iterations);
}

function cnpjFromSan(forge: Forge, cert: any): string {
  const extension = cert.getExtension("subjectAltName");
  if (!extension?.value)
    throw new CertificateError(
      "MISSING_CNPJ",
      "O A1 não contém o CNPJ da empresa no campo ICP-Brasil esperado.",
    );
  const sans = children(forge.asn1.fromDer(extension.value));
  const found: string[] = [];
  for (const name of sans) {
    // GeneralName.otherName is context-specific [0], implicitly tagged.
    if (name.tagClass !== 128 || name.type !== 0) continue;
    const values = children(name);
    if (numericOid(forge, values[0]) !== "2.16.76.1.3.3") continue;
    const value = children(values[1])[0];
    if (
      value &&
      [12, 19, 22, 4].includes(value.type) &&
      typeof value.value === "string" &&
      /^\d{14}$/.test(value.value)
    )
      found.push(value.value);
  }
  if (found.length !== 1)
    throw new CertificateError(
      "MISSING_CNPJ",
      "Não foi possível identificar um único CNPJ no A1 da empresa.",
    );
  return found[0];
}

function isA1(forge: Forge, cert: any) {
  const extension = cert.getExtension("certificatePolicies");
  if (!extension?.value) return false;
  const policies = children(forge.asn1.fromDer(extension.value));
  return policies.some((policy) =>
    /^2\.16\.76\.1\.2\.1\.\d+(?:\.\d+)*$/.test(
      numericOid(forge, children(policy)[0]),
    ),
  );
}

export function validateCertificate(
  forge: Forge,
  file: Uint8Array,
  password: string,
  issuerCnpj: string,
  rootsPem: string,
  now = new Date(),
) {
  if (!file.length || file.length > MAX_CERTIFICATE_BYTES)
    throw new CertificateError(
      "FILE_SIZE",
      "Envie um arquivo A1 de até 512 KB.",
      413,
    );
  if (
    typeof password !== "string" ||
    new TextEncoder().encode(password).length > 1024
  )
    throw new CertificateError(
      "INVALID_PASSWORD",
      "A senha informada não é suportada.",
    );
  let binary = "";
  for (let offset = 0; offset < file.length; offset += 8192)
    binary += String.fromCharCode(...file.subarray(offset, offset + 8192));
  let pfx: any;
  try {
    const asn = forge.asn1.fromDer(binary, {
      strict: true,
      parseAllBytes: true,
      maxDepth: 48,
    });
    inspectAsn1(forge, asn);
    pfx = forge.pkcs12.pkcs12FromAsn1(asn, true, password);
  } catch (error) {
    if (error instanceof CertificateError) throw error;
    throw new CertificateError(
      "INVALID_PFX",
      "Não foi possível abrir o A1. Confira a senha e se o arquivo .pfx/.p12 está íntegro e em um formato suportado.",
    );
  } finally {
    binary = "";
  }
  const bags = pfx.safeContents.flatMap((safe: any) => safe.safeBags);
  const keys = bags.filter((bag: any) => bag.key).map((bag: any) => bag.key);
  const certificates = bags
    .filter((bag: any) => bag.cert)
    .map((bag: any) => bag.cert);
  if (keys.length !== 1 || certificates.length > 12)
    throw new CertificateError(
      "PRIVATE_KEY",
      "O arquivo deve conter uma única chave privada e a cadeia do certificado da empresa.",
    );
  const key = keys[0];
  const matching = certificates.filter(
    (cert: any) =>
      cert.publicKey?.n?.equals(key.n) && cert.publicKey?.e?.equals(key.e),
  );
  if (matching.length !== 1)
    throw new CertificateError(
      "KEY_MISMATCH",
      "A chave privada não corresponde a um único certificado no arquivo.",
    );
  const cert = matching[0];
  if (cert.getExtension("basicConstraints")?.cA)
    throw new CertificateError(
      "NOT_LEAF",
      "Envie o certificado da empresa, não o de uma autoridade certificadora.",
    );
  if (key.n.bitLength() < 2048)
    throw new CertificateError(
      "WEAK_KEY",
      "O certificado precisa ter chave RSA de pelo menos 2048 bits.",
    );
  if (now < cert.validity.notBefore)
    throw new CertificateError(
      "NOT_YET_VALID",
      "A validade deste certificado ainda não começou.",
    );
  if (now >= cert.validity.notAfter)
    throw new CertificateError(
      "EXPIRED",
      "O certificado está vencido. Envie um A1 renovado.",
    );
  if (
    !cert.getExtension("keyUsage")?.digitalSignature ||
    !cert.getExtension("extKeyUsage")?.clientAuth
  )
    throw new CertificateError(
      "KEY_USAGE",
      "O certificado precisa permitir assinatura digital e autenticação de cliente.",
    );
  if (
    ![
      "1.2.840.113549.1.1.11",
      "1.2.840.113549.1.1.12",
      "1.2.840.113549.1.1.13",
    ].includes(cert.signatureOid)
  )
    throw new CertificateError(
      "SIGNATURE_ALGORITHM",
      "O algoritmo de assinatura do A1 não é suportado. Utilize um certificado RSA com SHA-256 ou superior.",
    );
  if (!isA1(forge, cert))
    throw new CertificateError(
      "NOT_A1",
      "O certificado não identifica uma política A1 da ICP-Brasil suportada.",
    );
  const cnpj = cnpjFromSan(forge, cert);
  if (cnpj !== issuerCnpj)
    throw new CertificateError(
      "CNPJ_MISMATCH",
      "O CNPJ do A1 é diferente do emissor configurado no servidor.",
    );
  const rootPems =
    rootsPem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    ) || [];
  if (!rootPems.length)
    throw new CertificateError(
      "NOT_CONFIGURED",
      "As raízes de confiança ainda não estão configuradas no servidor.",
      503,
    );
  let roots: any[];
  try {
    roots = rootPems.map((pem) => forge.pki.certificateFromPem(pem));
    for (const root of roots) {
      if (
        !root.getExtension("basicConstraints")?.cA ||
        !root.isIssuer(root) ||
        !root.verify(root) ||
        now < root.validity.notBefore ||
        now >= root.validity.notAfter
      )
        throw new Error();
    }
  } catch {
    throw new CertificateError(
      "NOT_CONFIGURED",
      "A configuração das raízes de confiança precisa ser revisada.",
      503,
    );
  }
  const chain = [cert],
    used = new Set([cert]);
  while (!roots.some((root) => chain.at(-1).isIssuer(root))) {
    const current = chain.at(-1);
    const candidates = certificates.filter(
      (candidate: any) => !used.has(candidate) && current.isIssuer(candidate),
    );
    if (candidates.length !== 1) break;
    chain.push(candidates[0]);
    used.add(candidates[0]);
    if (chain.length > 10)
      throw new CertificateError(
        "UNTRUSTED_CHAIN",
        "A cadeia de certificação não é suportada.",
      );
  }
  try {
    forge.pki.verifyCertificateChain(forge.pki.createCaStore(roots), chain, {
      validityCheckDate: now,
    });
  } catch {
    throw new CertificateError(
      "UNTRUSTED_CHAIN",
      "A cadeia do certificado não foi reconhecida pelas raízes ICP-Brasil configuradas. Exporte o A1 com a cadeia completa.",
    );
  }
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = forge.md.sha256.create().update(der).digest().toHex();
  return {
    metadata: {
      cnpj,
      subject: String(
        cert.subject.getField("CN")?.value || "Certificado da empresa",
      ).slice(0, 250),
      authority: String(cert.issuer.getField("CN")?.value || "").slice(0, 250),
      fingerprint,
      validFrom: cert.validity.notBefore.toISOString(),
      validUntil: cert.validity.notAfter.toISOString(),
      validatedAt: now.toISOString(),
      chainVerified: true,
      revocationStatus: "not_checked",
      fiscalReady: false,
    },
    // Normalize server-side: never store the PFX password or original file.
    secret: {
      privateKeyPem: forge.pki.privateKeyToPem(key),
      certificatePem: forge.pki.certificateToPem(cert),
      chainPem: chain.slice(1).map((item) => forge.pki.certificateToPem(item)),
    },
  };
}
