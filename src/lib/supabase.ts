import { createClient } from "@supabase/supabase-js";

// A publishable key is designed to be shipped with the browser application.
// Row Level Security in Supabase is what protects the financial data.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://tzpoveyjetfobzeeybqu.supabase.co";
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_E7eLngzCQSeWuvhNYIQy6g_cBt1X05K";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

/**
 * Reads a table with the exact access token validated for the active session.
 * It keeps the financial dashboard from ever falling back to a stale anonymous
 * request when a browser has just restored or changed an authenticated session.
 */
export async function readAuthenticatedRows<T>(table: string, order?: string): Promise<T[]> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) throw new Error("Sessão não encontrada.");
  const params = new URLSearchParams({ select: "*" });
  if (order) params.set("order", order);
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Não foi possível ler os dados financeiros.");
  return payload as T[];
}
