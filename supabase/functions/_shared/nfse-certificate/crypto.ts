export class CertificateError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export type Envelope = {
  version: 1;
  keyId: string;
  iv: string;
  ciphertext: string;
};
export const base64 = (value: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 8192)
    binary += String.fromCharCode(...value.subarray(offset, offset + 8192));
  return btoa(binary);
};
export const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const context = (issuer: string, id: string, keyId: string) =>
  new TextEncoder().encode(`fincore:nfse:a1:v1:${issuer}:${id}:${keyId}`);

export function encryptionKey(
  keys: Record<string, string>,
  keyId: string,
): Uint8Array {
  try {
    const bytes = fromBase64(keys[keyId]);
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(keyId) || bytes.length !== 32)
      throw new Error();
    return bytes;
  } catch {
    throw new CertificateError(
      "NOT_CONFIGURED",
      "O armazenamento seguro do certificado ainda não está configurado.",
      503,
    );
  }
}

export async function sealCertificate(
  secret: object,
  issuer: string,
  id: string,
  keyId: string,
  rawKey: Uint8Array,
): Promise<Envelope> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(secret));
  try {
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: context(issuer, id, keyId),
        tagLength: 128,
      },
      key,
      plaintext,
    );
    return {
      version: 1,
      keyId,
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(encrypted)),
    };
  } finally {
    plaintext.fill(0);
  }
}

// Server-side only, for the future fiscal worker. No HTTP endpoint exposes it.
export async function openCertificate(
  envelope: Envelope,
  issuer: string,
  id: string,
  keys: Record<string, string>,
): Promise<Record<string, unknown>> {
  if (envelope.version !== 1)
    throw new Error("Unsupported certificate envelope");
  const rawKey = encryptionKey(keys, envelope.keyId);
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  rawKey.fill(0);
  const bytes = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(envelope.iv) as BufferSource,
        additionalData: context(issuer, id, envelope.keyId),
        tagLength: 128,
      },
      key,
      fromBase64(envelope.ciphertext) as BufferSource,
    ),
  );
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    bytes.fill(0);
  }
}
