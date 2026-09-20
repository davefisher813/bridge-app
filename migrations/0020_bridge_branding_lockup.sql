-- Bridge's wordmark, which stands alone at the top of every screen in
-- place of the org name. A no-op anywhere Bridge does not exist.
update orgs
set branding = coalesce(branding, '{}'::jsonb) || '{"lockup": "/logos/bridge-lockup.png"}'::jsonb
where slug = 'bridge';
