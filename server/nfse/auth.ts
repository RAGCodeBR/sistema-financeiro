import { FiscalError } from "../../supabase/functions/_shared/nfse-fiscal/model.ts";
const invalidKey = (error: any) =>
  /invalid api key|no api key|invalid apikey/i.test(
    String(error?.message || ""),
  );
const configurationError = () =>
  new FiscalError(
    "SERVER_AUTH_CONFIG",
    "A credencial técnica do serviço fiscal não foi aceita. Contate o suporte para corrigir a configuração; sua senha e o certificado não precisam ser alterados.",
    503,
  );
export async function validateFiscalServerAccess(admin: any) {
  const { error } = await admin.from("profiles").select("id").limit(1);
  if (error)
    throw invalidKey(error)
      ? configurationError()
      : new FiscalError(
          "AUTH_UNAVAILABLE",
          "O serviço fiscal não conseguiu validar o acesso ao Supabase. Tente novamente em instantes.",
          503,
        );
}
export function createFiscalAuthentication(admin: any) {
  return async (token: string) => {
    const { data, error } = await admin.auth.getUser(token);
    if (error) {
      if (invalidKey(error)) throw configurationError();
      if (
        Number(error.status) >= 500 ||
        error.name === "AuthRetryableFetchError"
      )
        throw new FiscalError(
          "AUTH_UNAVAILABLE",
          "A validação do login está temporariamente indisponível. Tente novamente em instantes.",
          503,
        );
      return null;
    }
    if (!data.user) return null;
    const { data: profile, error: failure } = await admin
      .from("profiles")
      .select("id,role,allowed_units,hidden_screens")
      .eq("id", data.user.id)
      .single();
    if (failure) {
      if (invalidKey(failure)) throw configurationError();
      if (failure.code === "PGRST116")
        throw new FiscalError(
          "FORBIDDEN",
          "Seu usuário não possui perfil cadastrado para acessar o serviço fiscal.",
          403,
        );
      throw new FiscalError(
        "AUTH_UNAVAILABLE",
        "Não foi possível conferir as permissões do seu usuário. Tente novamente em instantes.",
        503,
      );
    }
    if (!profile)
      throw new FiscalError(
        "FORBIDDEN",
        "Seu usuário não possui perfil cadastrado para acessar o serviço fiscal.",
        403,
      );
    return {
      id: profile.id,
      role: profile.role,
      allowedUnits: profile.allowed_units || [],
      hiddenScreens: profile.hidden_screens || [],
    };
  };
}
