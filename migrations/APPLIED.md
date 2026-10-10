# Migrations applied to production

The one record of which migration is on production (Supabase project
`emllcefqxyxyhqolrllo`), because production is changed by hand and drift
already happened once (0048 was applied without a history row; backend
audit F-03, 2026-10-06). `src/laws/appliedLaws.test.ts` fails the build
when a migration file has no row here.

How to keep it true:

1. Apply with Supabase `apply_migration` named exactly like the file
   (`0053_stub_reading_never_applied`), so production's own history
   (`supabase_migrations.schema_migrations`) records it.
2. In the same change, set its row here to `applied` with the history
   version and name. A new file starts as `pending`.
3. To compare, list production's history (`list_migrations`) against this
   table. Every `applied` row names the history entry that proves it.

Statuses: `applied`, `pending` (written, not on production), `cut` (never
to be applied). 0047 (View As) is cut and lives only on its branch.

| File | Status | Evidence on production |
| --- | --- | --- |
| 0001_core_schema.sql | applied | 20260919042751 0001_core_schema |
| 0002_athlete_intl_eligibility_fields.sql | applied | 20260919042800 0002_athlete_intl_eligibility_fields |
| 0003_recruiting_target_tracking_fields.sql | applied | 20260919043550 0003_recruiting_target_tracking_fields |
| 0004_target_communications.sql | applied | 20260919044227 0004_target_communications |
| 0005_recruiting_target_offer_fields.sql | applied | 20260919044756 0005_to_0007_offers_contacts_visits_documents |
| 0006_contacts_and_target_visits.sql | applied | 20260919044756 0005_to_0007_offers_contacts_visits_documents |
| 0007_documents.sql | applied | 20260919044756 0005_to_0007_offers_contacts_visits_documents |
| 0008_core_courses.sql | applied | 20260919044828 0008_to_0011_courses_scales_role_rls_undo |
| 0009_org_grading_scales.sql | applied | 20260919044828 0008_to_0011_courses_scales_role_rls_undo |
| 0010_role_aware_rls.sql | applied | 20260919044828 0008_to_0011_courses_scales_role_rls_undo |
| 0011_document_undo.sql | applied | 20260919044828 0008_to_0011_courses_scales_role_rls_undo |
| 0012_fundraising.sql | applied | 20260919044939 0012_0013_fundraising_and_board_governance |
| 0013_board_governance.sql | applied | 20260919044939 0012_0013_fundraising_and_board_governance |
| 0014_approved_course_lists.sql | applied | 20260919045204 0014_approved_course_lists |
| 0015_helpers_out_of_the_exposed_schema.sql | applied | 20260919050632 0015_helpers_out_of_the_exposed_schema |
| 0016_fk_indexes_and_initplan_policies.sql | applied | 20260919145854 0016_fk_indexes_and_initplan_policies |
| 0017_users_trigger_and_documents_bucket.sql | applied | 20260919145942 0017_users_trigger_and_documents_bucket |
| 0018_members_see_each_other.sql | applied | 20260919152457 0018_members_see_each_other |
| 0019_bridge_branding_logo.sql | applied | 20260920045821 bridge_branding_logo |
| 0020_bridge_branding_lockup.sql | applied | 20260920050339 bridge_branding_lockup |
| 0021_matching_and_metrics.sql | applied | 20260920194541 matching_and_metrics |
| 0022_family_role.sql | applied | 20260921014237 0022_family_role |
| 0023_athlete_guardians.sql | applied | 20260921014606 0023_athlete_guardians |
| 0024_family_reads_staff_and_own_documents.sql | applied | 20260921022150 0024_family_reads_staff_and_own_documents |
| 0025_docai_usage.sql | applied | 20260921032026 0025_docai_usage |
| 0026_family_links_follow_membership.sql | applied | 20260921034042 0026_family_links_follow_membership |
| 0027_target_aid.sql | applied | 20260921153302 0027_target_aid |
| 0028_doc_category_metrics.sql | applied | 20260921164658 0028_doc_category_metrics |
| 0029_document_hash_and_bucket_size.sql | applied | 20260921182819 document_hash_and_bucket_size |
| 0030_academics_first_preset.sql | applied | 20260921211123 academics_first_preset |
| 0031_member_reads_summaries.sql | applied | 20260921215353 member_reads_summaries |
| 0032_transfer_window_unique.sql | applied | 20260922015637 transfer_window_unique |
| 0033_member_rpc_signed_in_only.sql | applied | 20260922015958 member_rpc_signed_in_only; 20260922020109 member_rpc_revoke_anon |
| 0034_member_program_placement.sql | applied | 20260926024050 member_program_placement |
| 0035_graduated_and_drafted.sql | applied | 20260926045819 graduated_and_drafted |
| 0036_college_coaches.sql | applied | 20260926155244 college_coaches |
| 0037_school_location.sql | applied | 20260926155247 school_location |
| 0038_transferring_and_closed_from.sql | applied | 20260926183431 transferring_and_closed_from |
| 0039_advisors_messages_checkins.sql | applied | 20260927004656 0039_advisors_messages_checkins |
| 0040_high_schools_and_notes.sql | applied | 20260927044402 0040_high_schools_and_notes |
| 0041_access_levels_and_titles.sql | applied | 20260927204910 0041_access_levels_and_titles |
| 0042_fit_net_cost.sql | applied | 20260927214948 0042_fit_net_cost |
| 0043_advisor_assigned_at.sql | applied | 20260927225349 0043_advisor_assigned_at |
| 0044_activity_log.sql | applied | 20260929230838 0044_activity_log |
| 0045_doc_status_filed.sql | applied | 20260930042049 0045_doc_status_filed |
| 0046_assignments.sql | applied | 20260930042232 0046_assignments |
| 0048_document_vault.sql | applied | by hand on 2026-10-08, no history row; every object checked present on 2026-10-10 (docs/GO_LIVE_STATUS.md) |
| 0049_member_photos.sql | applied | 20261010061309 0049_member_photos |
| 0050_board_meetings.sql | applied | 20261010061607 0050_board_meetings |
| 0051_authority_log.sql | applied | 20261010164800 0051_authority_log |
| 0052_close_needs_review_shelf.sql | applied | 20261010192408 0052_close_needs_review_shelf |
| 0053_stub_reading_never_applied.sql | applied | 20261010201956 0053_stub_reading_never_applied |
| 0054_document_filed_as.sql | applied | 20261010203055 0054_document_filed_as |
| 0055_document_moves_back.sql | applied | 20261010235717 0055_document_moves_back |
