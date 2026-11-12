import { randomBytes, X509Certificate } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--roots") || !args.includes("--root-sha256")) {
  console.error(
    "Uso: node scripts/prepare-nfse-certificate-secrets.mjs --roots <bundle-publico.pem> --root-sha256 <fingerprints-SHA256-separados-por-virgula> [--out .local/nfse-certificate-secrets.env] [--origins https://ragcodebr.github.io]",
  );
  process.exit(1);
}
const rootDirectory = path.resolve(".local");
const target = path.resolve(
  args.includes("--out")
    ? option("--out")
    : ".local/nfse-certificate-secrets.env",
);
if (!target.startsWith(rootDirectory + path.sep))
  throw new Error(
    "O arquivo de segredos deve ficar dentro de .local, ignorado pelo Git.",
  );
const pem = await readFile(option("--roots"), "utf8");
const roots =
  pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ||
  [];
const pins = new Set(
  option("--root-sha256")
    .split(",")
    .map((value) => value.replace(/:/g, "").toLowerCase()),
);
if (!roots.length || [...pins].some((pin) => !/^[a-f0-9]{64}$/.test(pin)))
  throw new Error(
    "Informe as raízes públicas e seus fingerprints oficiais SHA-256.",
  );
const observed = new Set();
for (const rootPem of roots) {
  const root = new X509Certificate(rootPem),
    fingerprint = root.fingerprint256.replace(/:/g, "").toLowerCase();
  if (
    !root.ca ||
    !root.checkIssued(root) ||
    !root.verify(root.publicKey) ||
    !pins.has(fingerprint) ||
    new Date(root.validFrom) > new Date() ||
    new Date(root.validTo) <= new Date()
  )
    throw new Error(
      "O bundle contém uma raiz inválida ou que não corresponde aos fingerprints confiados.",
    );
  observed.add(fingerprint);
}
if (observed.size !== pins.size)
  throw new Error(
    "Nem todos os fingerprints informados estão presentes no bundle.",
  );
const origins = (
  args.includes("--origins")
    ? option("--origins")
    : "https://ragcodebr.github.io"
).split(",");
for (const origin of origins) {
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    (parsed.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
  )
    throw new Error(
      "Informe apenas origens HTTPS completas, ou loopback para testes locais.",
    );
}
const keyId = `v${new Date()
  .toISOString()
  .replace(/[^0-9]/g, "")
  .slice(0, 14)}`;
const contents =
  [
    "NFSE_ISSUER_CNPJ=60371448000143",
    `NFSE_CERTIFICATE_ACTIVE_KEY_ID=${keyId}`,
    `NFSE_CERTIFICATE_KEYS=${JSON.stringify({ [keyId]: randomBytes(32).toString("base64") })}`,
    `NFSE_ICP_ROOTS_PEM_B64=${Buffer.from(roots.join("\n")).toString("base64")}`,
    `NFSE_ALLOWED_ORIGINS=${origins.join(",")}`,
  ].join("\n") + "\n";
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, contents, { flag: "wx", mode: 0o600 });
console.log(
  `Arquivo de segredos criado em ${target}. Nenhuma chave foi exibida. Guarde uma cópia em um cofre de acesso restrito antes de ativar o serviço.`,
);
