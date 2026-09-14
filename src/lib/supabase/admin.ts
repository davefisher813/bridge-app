import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client. Server-only. Never import from client components.
// Bypasses RLS, so every call site is responsible for its own scoping.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
