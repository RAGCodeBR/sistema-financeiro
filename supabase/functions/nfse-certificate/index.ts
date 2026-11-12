import forge from "npm:node-forge@1.4.3";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { CertificateError } from "../_shared/nfse-certificate/crypto.ts";
import { createCertificateHandler } from "../_shared/nfse-certificate/handler.ts";

let keys: Record<string, string> = {};
try {
  keys = JSON.parse(Deno.env.get("NFSE_CERTIFICATE_KEYS") || "{}");
} catch {
  /* Handler stays closed. */
}
let rootsPem = Deno.env.get("NFSE_ICP_ROOTS_PEM") || "";
try {
  if (Deno.env.get("NFSE_ICP_ROOTS_PEM_B64"))
    rootsPem = atob(Deno.env.get("NFSE_ICP_ROOTS_PEM_B64")!);
} catch {
  rootsPem = "";
}
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(
  createCertificateHandler({
    forge,
    config: {
      // Public deployment identity is fixed server-side, never supplied by the
      // browser. Missing private secrets still keep certificate writes closed.
      issuerCnpj: Deno.env.get("NFSE_ISSUER_CNPJ") || "60371448000143",
      rootsPem,
      keyId: Deno.env.get("NFSE_CERTIFICATE_ACTIVE_KEY_ID") || "",
      keys,
      origins: (Deno.env.get("NFSE_ALLOWED_ORIGINS") || "https://ragcodebr.github.io")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
    authenticate: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return null;
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id,role,allowed_units,hidden_screens")
        .eq("id", data.user.id)
        .single();
      if (profileError || !profile) return null;
      return {
        id: profile.id,
        role: profile.role,
        allowedUnits: profile.allowed_units || [],
        hiddenScreens: profile.hidden_screens || [],
      };
    },
    rpc: async (name, params) => {
      const { data, error } = await admin.rpc(name, params);
      if (error) {
        if (error.message.includes("NFSE_CONFLICT"))
          throw new CertificateError(
            "CONFLICT",
            "O certificado foi alterado. Atualize a tela e tente novamente.",
            409,
          );
        if (error.code === "42501" || error.message.includes("NFSE_FORBIDDEN"))
          throw new CertificateError(
            "FORBIDDEN",
            "Acesso ao certificado não autorizado.",
            403,
          );
        throw new CertificateError(
          "SERVICE_UNAVAILABLE",
          "O serviço seguro do certificado está indisponível ou ainda não foi ativado.",
          503,
        );
      }
      return data;
    },
  }),
);
