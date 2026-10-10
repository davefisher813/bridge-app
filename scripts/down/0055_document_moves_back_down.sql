-- Back to 0048's seven moves.
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
        ('ready', 'archived'),
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
