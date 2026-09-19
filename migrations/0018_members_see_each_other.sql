-- The members screen needs two things the schema did not have.
--
-- 1. Whether a person has ever signed in. That fact lives on
--    auth.users.last_sign_in_at, which the app cannot read with a user's
--    own client. The profile trigger from 0017 now mirrors it onto
--    public.users, so "invited, never signed in" is a null there and a
--    page can say so without the service role.
--
-- 2. Members of an org can read each other's profile rows. users_self
--    (0001) let a person read only their own, which is right for a
--    stranger and wrong for a colleague: the roster of who can sign in
--    to Bridge is not a secret from the people who can sign in to
--    Bridge. The new policy is additive; a person in no shared org stays
--    invisible, and nothing here lets anyone write another's row.

alter table users add column last_sign_in_at timestamptz;

create or replace function private.handle_auth_user_change() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  insert into public.users (id, email, full_name, last_sign_in_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.last_sign_in_at
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.users.full_name = '' then excluded.full_name else public.users.full_name end,
        last_sign_in_at = excluded.last_sign_in_at;
  return new;
end $$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row execute function private.handle_auth_user_change();

update public.users u
  set last_sign_in_at = a.last_sign_in_at
  from auth.users a
  where a.id = u.id;

create policy users_in_my_orgs on users for select
  using (id in (select user_id from org_members where org_id in (select private._member_org_ids())));
