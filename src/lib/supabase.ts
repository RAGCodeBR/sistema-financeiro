import { createClient } from "@supabase/supabase-js";

// A publishable key is designed to be shipped with the browser application.
// Row Level Security in Supabase is what protects the financial data.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://tzpoveyjetfobzeeybqu.supabase.co";
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_E7eLngzCQSeWuvhNYIQy6g_cBt1X05K";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
