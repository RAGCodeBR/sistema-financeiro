import { FiscalError } from "./model.ts";
import { limitedBytes } from "./transport.ts";
import { compactCrl } from "./crl.ts";
const DEFAULT_HOSTS = [
  "acraiz.icpbrasil.gov.br",
  "icp-brasil.certisign.com.br",
  "repositorio.serpro.gov.br",
  "repositorio.acsoluti.com.br",
  "repositorio.soluti.com.br",
  "ccd.acsoluti.com.br",
  "ccd2.acsoluti.com.br",
  "lcr.certificadodigital.com.br",
  "ccd.serpro.gov.br",
];
export function allowedCrlUrl(
  text: string,
  hosts: string[] = DEFAULT_HOSTS,
): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new FiscalError(
      "CRL_URL",
      "Endereço de verificação do certificado inválido.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    !hosts.includes(url.hostname.toLowerCase()) ||
    (url.port &&
      !(
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443")
      ))
  )
    throw new FiscalError(
      "CRL_HOST",
      "O domínio da LCR precisa ser autorizado e conferido pelo administrador.",
    );
  return url;
}
export function certificateCrlUrls(forge: any, cert: any): string[] {
  const extension = cert.getExtension("cRLDistributionPoints");
  if (!extension?.value) return [];
  const result: string[] = [];
  const visit = (node: any, depth = 0) => {
    if (depth > 20) return;
    if (
      node.tagClass === 128 &&
      node.type === 6 &&
      typeof node.value === "string"
    )
      result.push(node.value);
    if (Array.isArray(node.value))
      for (const child of node.value) visit(child, depth + 1);
  };
  visit(forge.asn1.fromDer(extension.value));
  return [...new Set(result)].slice(0, 4);
}
export function createRevocationChecker({
  forge,
  PKI,
  ASN1,
  fetcher,
  allowedHosts = [],
}: any) {
  const hosts = [...DEFAULT_HOSTS, ...allowedHosts];
  const der = (cert: any) => {
    const bytes = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    return Uint8Array.from(bytes, (char: string) => char.charCodeAt(0));
  };
  const asPki = (cert: any) => PKI.Certificate.fromBER(der(cert).buffer);
  return async (
    certificatePem: string,
    chainPems: string[],
    rootsPem: string,
    now = new Date(),
  ) => {
    const leaf = forge.pki.certificateFromPem(certificatePem),
      roots = (
        rootsPem.match(
          /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
        ) || []
      ).map((pem: string) => forge.pki.certificateFromPem(pem));
    const supplied = chainPems.map((pem: string) =>
        forge.pki.certificateFromPem(pem),
      ),
      ordered = [leaf],
      seen = new Set<any>([leaf]);
    while (!roots.some((root: any) => ordered.at(-1).isIssuer(root))) {
      const current = ordered.at(-1),
        next = supplied.find(
          (cert: any) => !seen.has(cert) && current.isIssuer(cert),
        );
      if (!next)
        throw new FiscalError(
          "CERTIFICATE_CHAIN",
          "Não foi possível reconstruir a cadeia do A1.",
        );
      ordered.push(next);
      seen.add(next);
      if (ordered.length > 10)
        throw new FiscalError(
          "CERTIFICATE_CHAIN",
          "Cadeia do A1 não suportada.",
        );
    }
    try {
      forge.pki.verifyCertificateChain(
        forge.pki.createCaStore(roots),
        ordered,
        { validityCheckDate: now },
      );
    } catch {
      throw new FiscalError(
        "CERTIFICATE_CHAIN",
        "A cadeia ou a validade atual do A1 não foi confirmada.",
      );
    }
    const root = roots.find((root: any) => ordered.at(-1).isIssuer(root));
    if (!root || now < root.validity.notBefore || now >= root.validity.notAfter)
      throw new FiscalError(
        "CERTIFICATE_CHAIN",
        "A raiz de confiança não está válida.",
      );
    const all = [...ordered, root],
      checks: any[] = [];
    let validUntil = now.getTime() + 5 * 60 * 1000;
    for (let index = 0; index < ordered.length; index++) {
      const cert = all[index],
        issuer = all[index + 1];
      let verified = false;
      const urls = certificateCrlUrls(forge, cert);
      if (!urls.length)
        throw new FiscalError(
          "CRL_UNAVAILABLE",
          "A cadeia do certificado não informa uma LCR suportada. A assinatura permanece bloqueada.",
          503,
        );
      let rejectedHost = false;
      for (const source of urls) {
        try {
          let url: URL;
          try {
            url = allowedCrlUrl(source, hosts);
          } catch (error) {
            rejectedHost = true;
            throw error;
          }
          const response = await fetcher(url.href, {
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) continue;
          let bytes = await limitedBytes(response, 12 * 1024 * 1024);
          const text = new TextDecoder().decode(bytes.slice(0, 64));
          if (text.includes("BEGIN X509 CRL")) {
            const pem = new TextDecoder().decode(bytes);
            const base64 = pem.replace(/-----[^-]+-----|\s/g, "");
            bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          }
          const scanned = compactCrl(bytes, cert.serialNumber);
          const parsed = ASN1.fromBER(scanned.compact, {
            maxDepth: 24,
            maxNodes: 4000,
            maxContentLength: 128 * 1024,
            parseEmbedded: false,
            copyInput: false,
          });
          if (parsed.offset !== scanned.compact.length) continue;
          const crl = new PKI.CertificateRevocationList({
            schema: parsed.result,
          });
          crl.tbsView = scanned.tbs;
          if (
            !crl.issuer.isEqual(asPki(issuer).subject) ||
            !(await crl.verify({ issuerCertificate: asPki(issuer) }))
          )
            continue;
          if (
            !crl.nextUpdate ||
            crl.thisUpdate.value.getTime() > now.getTime() + 300000 ||
            crl.nextUpdate.value <= now
          )
            continue;
          if (
            crl.crlExtensions?.extensions?.some(
              (extension: any) =>
                extension.extnID === "2.5.29.27" ||
                extension.extnID === "2.5.29.28",
            )
          )
            continue;
          if (
            crl.crlExtensions?.extensions?.some(
              (extension: any) =>
                extension.critical &&
                !["2.5.29.35", "2.5.29.20"].includes(extension.extnID),
            )
          )
            continue;
          if (scanned.revoked)
            throw new FiscalError(
              "CERTIFICATE_REVOKED",
              "O A1 ou uma autoridade da sua cadeia consta como revogado. A emissão está bloqueada.",
              403,
            );
          validUntil = Math.min(validUntil, crl.nextUpdate.value.getTime());
          checks.push({
            authority: String(issuer.subject.getField("CN")?.value || ""),
            host: url.hostname,
            nextUpdate: crl.nextUpdate.value.toISOString(),
          });
          verified = true;
          break;
        } catch (error) {
          if (
            error instanceof FiscalError &&
            error.code === "CERTIFICATE_REVOKED"
          )
            throw error;
        }
      }
      if (!verified)
        throw new FiscalError(
          rejectedHost ? "CRL_HOST" : "CRL_UNAVAILABLE",
          rejectedHost
            ? "O domínio da LCR precisa ser autorizado pelo administrador após conferir a origem na cadeia ICP-Brasil."
            : "Não foi possível obter uma LCR válida e atual. A assinatura permanece bloqueada.",
          503,
        );
    }
    return {
      status: "good",
      checkedAt: now.toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      checks,
    };
  };
}
