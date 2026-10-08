#!/usr/bin/env bash
# Runs the real RLS-enforcement test against a throwaway local Postgres
# database. Requires a running local Postgres (Docker's fine too, adjust
# the psql invocation) and enough privilege to create/drop a database
# and a role. Never run this against a database with real data: it
# drops and recreates app_user and seeds fixed-UUID rows.
set -euo pipefail
cd "$(dirname "$0")/.."

DB=recruiting_platform_rls_test

echo "==> Recreating throwaway database $DB"
su postgres -c "psql -c 'drop database if exists $DB;'"
su postgres -c "psql -c 'create database $DB;'"

echo "==> Applying auth stub"
su postgres -c "psql -d $DB -f scripts/local_auth_stub.sql"

# Supabase's own default privileges: every table and function created in
# public is granted to anon and authenticated unless a migration revokes
# it. Without this, a local anon role holds no grant on anything and a
# "revoke ... from anon" in a migration is untestable: the assertion
# that anon cannot read a table would pass with the revoke deleted.
echo "==> Mirroring Supabase's default grants to anon and authenticated"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL

echo "==> Applying schema migrations"
su postgres -c "psql -d $DB -f migrations/0001_core_schema.sql"
su postgres -c "psql -d $DB -f migrations/0002_athlete_intl_eligibility_fields.sql"
su postgres -c "psql -d $DB -f migrations/0003_recruiting_target_tracking_fields.sql"
su postgres -c "psql -d $DB -f migrations/0004_target_communications.sql"
su postgres -c "psql -d $DB -f migrations/0005_recruiting_target_offer_fields.sql"
su postgres -c "psql -d $DB -f migrations/0006_contacts_and_target_visits.sql"
su postgres -c "psql -d $DB -f migrations/0007_documents.sql"
su postgres -c "psql -d $DB -f migrations/0008_core_courses.sql"
su postgres -c "psql -d $DB -f migrations/0009_org_grading_scales.sql"
su postgres -c "psql -d $DB -f migrations/0010_role_aware_rls.sql"
su postgres -c "psql -d $DB -f migrations/0011_document_undo.sql"
su postgres -c "psql -d $DB -f migrations/0012_fundraising.sql"
su postgres -c "psql -d $DB -f migrations/0013_board_governance.sql"
su postgres -c "psql -d $DB -f migrations/0014_approved_course_lists.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0015_helpers_out_of_the_exposed_schema.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0016_fk_indexes_and_initplan_policies.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0017_users_trigger_and_documents_bucket.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0018_members_see_each_other.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0019_bridge_branding_logo.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0020_bridge_branding_lockup.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0021_matching_and_metrics.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0022_family_role.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0023_athlete_guardians.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0024_family_reads_staff_and_own_documents.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0025_docai_usage.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0026_family_links_follow_membership.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0027_target_aid.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0028_doc_category_metrics.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0029_document_hash_and_bucket_size.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0030_academics_first_preset.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0031_member_reads_summaries.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0032_transfer_window_unique.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0033_member_rpc_signed_in_only.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0034_member_program_placement.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0035_graduated_and_drafted.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0036_college_coaches.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0037_school_location.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0038_transferring_and_closed_from.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0039_advisors_messages_checkins.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0040_high_schools_and_notes.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0041_access_levels_and_titles.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0042_fit_net_cost.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0043_advisor_assigned_at.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0044_activity_log.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0045_doc_status_filed.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0046_assignments.sql"

# 0048 (the document vault): one old document of each old status goes in
# first, so the migration's backfill is checked against the mapping table
# in docs/PLAN_DOCAI_PIECE1.md; then the migration; then the check.
echo "==> 0048: seeding one old document of each old status"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/vault_mapping_pre.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0048_document_vault.sql"
echo "==> 0048: checking the old-status mapping"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/vault_mapping_post.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0049_document_identity_and_type.sql"

echo "==> Seeding data and running RLS assertions"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/rls_test.sql"

# 0048 must be reversible: take it off the finished test database with its
# down script, put it back, and check the guards are there again.
echo "==> 0049 and 0048: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0049_document_identity_and_type_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'documents' and column_name in ('suggested_type', 'identity_status', 'subject_athlete_id')\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0048_document_vault_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'documents' and column_name in ('lifecycle', 'format', 'uploaded_by', 'review_reason', 'original_paths', 'lifecycle_changed_at')\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0048_document_vault.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_trigger where tgname in ('documents_insert_guard', 'documents_original_is_immutable', 'documents_lifecycle_transition')\"" | grep -qx 3
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0049_document_identity_and_type.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_trigger where tgname = 'documents_subject_is_coherent'\"" | grep -qx 1
echo "==> 0048 and 0049 are reversible"

echo "==> Dropping throwaway database"
su postgres -c "psql -c 'drop database if exists $DB;'"

echo "==> Done. See output above for PASS lines; a FAIL raises an error and stops the script."
