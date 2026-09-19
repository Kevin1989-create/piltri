import { createClient } from "@supabase/supabase-js";

/** Browser-safe client — public URL + anon key only (RLS-restricted to reads). */
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars are not set. See .env.example.");
  }
  return createClient(url, anonKey);
}
