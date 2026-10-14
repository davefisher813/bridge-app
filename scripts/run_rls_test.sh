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
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0049_member_photos.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0050_board_meetings.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0051_authority_log.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0052_close_needs_review_shelf.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0053_stub_reading_never_applied.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0054_document_filed_as.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0055_document_moves_back.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0056_checkin_photos.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0057_migration_status.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0058_document_athlete_link.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0059_doc_category_athlete_profile.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0060_doc_category_board_other.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0061_activity_document_deleted.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0062_activity_board_seat_donor_linked.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0063_family_reads_columns_not_rows.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0064_member_giving_follows_module.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0065_family_reads_policies.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0066_family_sends_document.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0067_doc_approvers.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0068_access_tightening.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0069_document_title.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0070_org_master_account.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0072_documents_bulk.sql"

echo "==> Seeding data and running RLS assertions"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/rls_test.sql"

# 0048 must be reversible: take it off the finished test database with its
# down script, put it back, and check the guards are there again.
echo "==> 0048: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0048_document_vault_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'documents' and column_name in ('lifecycle', 'format', 'uploaded_by', 'review_reason', 'original_paths', 'lifecycle_changed_at')\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0048_document_vault.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_trigger where tgname in ('documents_insert_guard', 'documents_original_is_immutable', 'documents_lifecycle_transition')\"" | grep -qx 3
echo "==> 0048 is reversible"
echo "==> 0049 and 0050: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0050_board_meetings_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0049_member_photos_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0049_member_photos.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0050_board_meetings.sql"
echo "==> 0049 and 0050 are reversible"
echo "==> 0051: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0051_authority_log_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0051_authority_log.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/check_0051.sql"
echo "==> 0051 is reversible"
echo "==> 0053: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0053_stub_reading_never_applied_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0053_stub_reading_never_applied.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_trigger where tgname = 'documents_stub_never_applied'\"" | grep -qx 1
echo "==> 0053 is reversible"
echo "==> 0054: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0054_document_filed_as_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0054_document_filed_as.sql"
echo "==> 0054 is reversible"
echo "==> 0055: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0055_document_moves_back_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0055_document_moves_back.sql"
echo "==> 0055 is reversible"
echo "==> 0063 and 0065: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0065_family_reads_policies_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0063_family_reads_columns_not_rows_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0063_family_reads_columns_not_rows.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0065_family_reads_policies.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_proc where proname in ('family_targets', 'family_target_visits', 'family_documents', 'family_document_twin')\"" | grep -qx 4
echo "==> 0063 and 0065 are reversible"
echo "==> 0056: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0056_checkin_photos_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0056_checkin_photos.sql"
echo "==> 0056 is reversible"
echo "==> 0057: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0057_migration_status_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0057_migration_status.sql"
echo "==> 0057 is reversible"
echo "==> 0058: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0058_document_athlete_link_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0058_document_athlete_link.sql"
echo "==> 0058 is reversible"
echo "==> 0067: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0067_doc_approvers_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'documents' and column_name in ('approved_by', 'approved_at')\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.tables where table_name = 'doc_approvers'\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0067_doc_approvers.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_trigger where tgname in ('doc_approvers_is_admin', 'documents_ready_by_approver')\"" | grep -qx 2
echo "==> 0067 is reversible"
echo "==> 0068: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0068_access_tightening_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_proc where proname = '_family_upload_folders'\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0068_access_tightening.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_policy where polname = 'documents_bucket_family_insert' and pg_get_expr(polwithcheck, polrelid) ~ '_family_upload_folders'\"" | grep -qx 1
echo "==> 0068 is reversible"
echo "==> 0069: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0069_document_title_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0069_document_title.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'documents' and column_name = 'title'\"" | grep -qx 1
echo "==> 0069 is reversible"

echo "==> 0066: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0066_family_sends_document_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_proc where proname = 'family_send_document'\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'documents' and column_name = 'family_note'\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0066_family_sends_document.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_proc where proname = 'family_send_document'\"" | grep -qx 1
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_policy where polname = 'documents_bucket_family_insert' and pg_get_expr(polwithcheck, polrelid) ~ '_family_athlete_ids'\"" | grep -qx 1
echo "==> 0066 is reversible"
echo "==> 0070: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0070_org_master_account_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from information_schema.columns where table_name = 'orgs' and column_name = 'master_user_id'\"" | grep -qx 0
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0070_org_master_account.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_trigger where tgname in ('orgs_master_is_admin', 'org_members_master_stays')\"" | grep -qx 2
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_proc where proname = 'family_documents' and prosrc ~ 'recommendation'\"" | grep -qx 1
echo "==> 0070 is reversible"
echo "==> 0072: down, then up again"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/down/0072_documents_bulk_down.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f migrations/0072_documents_bulk.sql"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -tA -c \"select count(*) from pg_enum where enumlabel = 'document_typed'\"" | grep -qx 1
echo "==> 0072 is reversible"

echo "==> Dropping throwaway database"
su postgres -c "psql -c 'drop database if exists $DB;'"

echo "==> Done. See output above for PASS lines; a FAIL raises an error and stops the script."
