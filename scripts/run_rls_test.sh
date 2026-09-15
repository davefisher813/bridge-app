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

echo "==> Seeding data and running RLS assertions"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/rls_test.sql"

echo "==> Dropping throwaway database"
su postgres -c "psql -c 'drop database if exists $DB;'"

echo "==> Done. See output above for PASS lines; a FAIL raises an error and stops the script."
