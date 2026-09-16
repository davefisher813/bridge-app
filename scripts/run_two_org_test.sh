#!/usr/bin/env bash
# Stands up two real organizations on one database and proves they stay
# apart, differ only in config, and share what is meant to be shared.
#
# This is the test of the claim the whole architecture makes. Every
# migration has been multi-tenant from day one on the strength of an
# intention; this runs it. Never against anything real: it drops and
# recreates a database and a role.
set -euo pipefail
cd "$(dirname "$0")/.."

DB=recruiting_platform_two_org_test

echo "==> Recreating throwaway database $DB"
su postgres -c "psql -c 'drop database if exists $DB;'"
su postgres -c "psql -c 'create database $DB;'"

echo "==> Applying auth stub and every migration in order"
su postgres -c "psql -q -d $DB -f scripts/local_auth_stub.sql" > /dev/null
for m in migrations/*.sql; do
  su postgres -c "psql -q -d $DB -f $m" > /dev/null
done

echo "==> Seeding two orgs and running the assertions"
su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -f scripts/seed_two_orgs.sql"

echo "==> Dropping throwaway database"
su postgres -c "psql -c 'drop database if exists $DB;'"

echo "==> Done."
