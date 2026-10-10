-- 0055: two more document moves (Alfred's production audit, 2026-10-10).
--
--   ready -> needs_review: Mark Ready had no undo. A document marked Ready
--     by mistake could only be archived. Now a person can move it back.
--   needs_review -> processing: Read Again. A document waiting in review
--     with a reading type can be read again on demand (a clearer copy of
--     the rules, a type picked after upload), and comes back to Needs
--     Review when the reading ends.
--
-- The same list as src/lib/vault/lifecycle.ts; a law compares the two.
-- Replaces the function from 0048; the trigger is unchanged.

create or replace function private.documents_lifecycle_transition() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.lifecycle is distinct from old.lifecycle then
    if not exists (
      select 1
      from (values
        ('uploaded', 'processing'),
        ('uploaded', 'needs_review'),
        ('processing', 'needs_review'),
        ('needs_review', 'ready'),
        ('needs_review', 'archived'),
        ('needs_review', 'processing'),
        ('ready', 'archived'),
        ('ready', 'needs_review'),
        ('archived', 'needs_review')
      ) as allowed(f, t)
      where allowed.f = old.lifecycle::text and allowed.t = new.lifecycle::text
    ) then
      raise exception 'documents: % to % is not an allowed move', old.lifecycle, new.lifecycle
        using errcode = 'check_violation';
    end if;
    new.lifecycle_changed_at := clock_timestamp();
  end if;
  return new;
end $$;
