# Setup checklist: what Dave has to do

Rewritten 2026-09-19 after the first deployment. Everything Claude can
reach has been done: the repo is on GitHub, production is on Vercel, the
schema is on Supabase, Vercel Authentication is off, the password is
set. What is left is three settings behind dashboards no tool here can
reach. About ten minutes, phone is fine.

## 1. The service role key, on Vercel

Needed by: inviting members, changing roles, removing members, the
schools admin form, and Doc AI writing a shared grading scale. Each says
"the service role key is missing" until this is done.

1. **supabase.com**, open **Bridge-app**.
2. **Project Settings**, then **API**.
3. Under **Project API keys**, find **service_role**. **Reveal**, copy.
4. **vercel.com**, open **commit-app**, **Settings**, **Environment
   Variables**.
5. Name `SUPABASE_SERVICE_ROLE_KEY`, paste the value, all three
   environments. Save.
6. **Deployments**, latest, **Redeploy**. Env vars apply on the next
   build.

Never paste that key into a chat or the repo. It bypasses every RLS
policy in the database.

## 2. Auth URLs and email templates, on Supabase

Needed by: magic link sign-in and invitation emails. Without the URLs
every link bounces to localhost. Without the template change a link
opened from Mail on an iPhone can fail, because Supabase's default link
needs the same browser that asked for it.

1. **supabase.com**, **Bridge-app**, **Authentication**, **URL
   Configuration**.
2. **Site URL:** `https://commit-app-nu.vercel.app`
3. **Redirect URLs**, add: `https://commit-app-nu.vercel.app/auth/callback`
   and `https://commit-app-nu.vercel.app/**`
4. **Authentication**, **Email Templates**.
5. **Magic Link** template: replace the link's `href` with
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink`
6. **Invite user** template: same idea,
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite`
7. Save both.

When a custom domain exists, repeat steps 2, 3 with it.

## 3. Leaked-password protection, on Supabase

Now that a password exists. One toggle.

1. **Authentication**, **Providers**, **Email** (or **Attack Protection**
   on newer dashboards).
2. Turn on **Leaked password protection**. Save.

## Later, not now

**The Anthropic API key.** Doc AI runs on a stand-in and says so on
every screen. Before a real key goes in, two things are owed by Claude:
a real `ModelCaller` (today only the stand-in exists, and the "simulated"
notice keys off the env var, so setting the key alone would hide the
notice without changing anything) and a per-org spending budget table.

**The domain.** A subdomain of the BFFSA domain, or its own. Added in
Vercel, then step 2 above again.

**The name.** Still unconfirmed. Renaming the GitHub repo is one field
and old links redirect; the Vercel project and the Supabase project
keep their own names either way.
