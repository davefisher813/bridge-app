import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// The person actually signed in: the real caller, never the person a View
// As is showing (src/lib/data/viewAs.ts). The auth check is a network
// call to Supabase Auth, not a cookie read, and it used to run once per
// lookup. Once per request now, and shared by the guard and by the View
// As reader so neither pays for it twice.
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
