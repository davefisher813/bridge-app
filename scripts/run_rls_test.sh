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

echo "==> Seeding data and running RLS assertions"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/rls_test.sql"

echo "==> Dropping throwaway database"
su postgres -c "psql -c 'drop database if exists $DB;'"

echo "==> Done. See output above for PASS lines; a FAIL raises an error and stops the script."
