-- 0052: close public.needs_review_shelf (found 2026-10-10 by the Supabase
-- security advisor, level ERROR).
--
-- The view is not from this repo: it was created by hand on production,
-- outside the migrations. It listed every document in Needs Review (id,
-- file name, format, review reason, dates) across every org, ran with
-- its owner's rights so row level security never applied, and the
-- signed-out role could read it: 17 rows were readable with the public
-- key on 2026-10-10. Nothing in the app reads it.
--
-- Not dropped (it is not ours to remove): it now runs with the caller's
-- rights, and neither the signed-out nor the signed-in role may read it.
-- A no-op where the view does not exist (local test databases).

do $$
begin
  if to_regclass('public.needs_review_shelf') is not null then
    execute 'alter view public.needs_review_shelf set (security_invoker = true)';
    execute 'revoke all on public.needs_review_shelf from anon, authenticated';
  end if;
end $$;
