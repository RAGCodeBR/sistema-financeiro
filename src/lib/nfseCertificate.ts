export type NfseCertificateMetadata = {
  id: string;
  cnpj: string;
  subject: string;
  authority: string;
  fingerprint: string;
  validFrom: string;
  validUntil: string;
  validatedAt: string;
  uploadedAt: string;
  chainVerified: boolean;
  revocationStatus: "not_checked" | "unknown" | "good" | "revoked";
  revocationCheckedAt?: string;
  fiscalReady: false;
};
export type NfseCertificateStatus = {
  configured: boolean;
  issuerCnpj: string;
  canManage: boolean;
  certificate: NfseCertificateMetadata | null;
  fiscalReady: false;
  message?: string;
};
export type NfseCertificateService = {
  status: (signal?: AbortSignal) => Promise<NfseCertificateStatus>;
  upload: (
    file: File,
    password: string,
    expectedId: string | null,
    signal?: AbortSignal,
  ) => Promise<void>;
  remove: (expectedId: string) => Promise<void>;
};
