import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client using the service role key — bypasses RLS.
 * Used exclusively by the aggregation/caching layer in API routes.
 * Never import this from a client component.
 */
export function getSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase service role env vars are not set. See .env.example.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
