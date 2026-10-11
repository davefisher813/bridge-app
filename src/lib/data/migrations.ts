import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// The database's own migration history (migration 0057), Admins only.
// Null when it cannot be read, so the screen says so instead of
// reporting everything missing.
export async function loadMigrationHistory(supabase: Client): Promise<{ version: string; name: string }[] | null> {
  const { data, error } = await supabase.rpc("applied_migrations");
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data as { version: string; name: string }[];
}
