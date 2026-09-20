-- Bridge's mark on its org row. orgs.branding has been the home for a
-- logo since 0001; this is the first row to carry one. The file itself
-- ships with the app under public/logos. A no-op anywhere Bridge does
-- not exist.
update orgs
set branding = coalesce(branding, '{}'::jsonb) || '{"logo": "/logos/bridge-mark.png"}'::jsonb
where slug = 'bridge';
