// Generated from migrations/APPLIED.md by scripts/gen_applied_ledger.mjs.
// Do not edit by hand: change APPLIED.md and run the script. A law fails
// the build when the two differ.

export type LedgerStatus = "applied" | "pending" | "cut";

export interface LedgerRow {
  file: string;
  recorded: LedgerStatus;
  // The production history versions that prove it (none when applied by
  // hand, or not applied).
  versions: string[];
}

export const APPLIED_LEDGER: LedgerRow[] = [
  { file: "0001_core_schema", recorded: "applied", versions: ["20260919042751"] },
  { file: "0002_athlete_intl_eligibility_fields", recorded: "applied", versions: ["20260919042800"] },
  { file: "0003_recruiting_target_tracking_fields", recorded: "applied", versions: ["20260919043550"] },
  { file: "0004_target_communications", recorded: "applied", versions: ["20260919044227"] },
  { file: "0005_recruiting_target_offer_fields", recorded: "applied", versions: ["20260919044756"] },
  { file: "0006_contacts_and_target_visits", recorded: "applied", versions: ["20260919044756"] },
  { file: "0007_documents", recorded: "applied", versions: ["20260919044756"] },
  { file: "0008_core_courses", recorded: "applied", versions: ["20260919044828"] },
  { file: "0009_org_grading_scales", recorded: "applied", versions: ["20260919044828"] },
  { file: "0010_role_aware_rls", recorded: "applied", versions: ["20260919044828"] },
  { file: "0011_document_undo", recorded: "applied", versions: ["20260919044828"] },
  { file: "0012_fundraising", recorded: "applied", versions: ["20260919044939"] },
  { file: "0013_board_governance", recorded: "applied", versions: ["20260919044939"] },
  { file: "0014_approved_course_lists", recorded: "applied", versions: ["20260919045204"] },
  { file: "0015_helpers_out_of_the_exposed_schema", recorded: "applied", versions: ["20260919050632"] },
  { file: "0016_fk_indexes_and_initplan_policies", recorded: "applied", versions: ["20260919145854"] },
  { file: "0017_users_trigger_and_documents_bucket", recorded: "applied", versions: ["20260919145942"] },
  { file: "0018_members_see_each_other", recorded: "applied", versions: ["20260919152457"] },
  { file: "0019_bridge_branding_logo", recorded: "applied", versions: ["20260920045821"] },
  { file: "0020_bridge_branding_lockup", recorded: "applied", versions: ["20260920050339"] },
  { file: "0021_matching_and_metrics", recorded: "applied", versions: ["20260920194541"] },
  { file: "0022_family_role", recorded: "applied", versions: ["20260921014237"] },
  { file: "0023_athlete_guardians", recorded: "applied", versions: ["20260921014606"] },
  { file: "0024_family_reads_staff_and_own_documents", recorded: "applied", versions: ["20260921022150"] },
  { file: "0025_docai_usage", recorded: "applied", versions: ["20260921032026"] },
  { file: "0026_family_links_follow_membership", recorded: "applied", versions: ["20260921034042"] },
  { file: "0027_target_aid", recorded: "applied", versions: ["20260921153302"] },
  { file: "0028_doc_category_metrics", recorded: "applied", versions: ["20260921164658"] },
  { file: "0029_document_hash_and_bucket_size", recorded: "applied", versions: ["20260921182819"] },
  { file: "0030_academics_first_preset", recorded: "applied", versions: ["20260921211123"] },
  { file: "0031_member_reads_summaries", recorded: "applied", versions: ["20260921215353"] },
  { file: "0032_transfer_window_unique", recorded: "applied", versions: ["20260922015637"] },
  { file: "0033_member_rpc_signed_in_only", recorded: "applied", versions: ["20260922015958","20260922020109"] },
  { file: "0034_member_program_placement", recorded: "applied", versions: ["20260926024050"] },
  { file: "0035_graduated_and_drafted", recorded: "applied", versions: ["20260926045819"] },
  { file: "0036_college_coaches", recorded: "applied", versions: ["20260926155244"] },
  { file: "0037_school_location", recorded: "applied", versions: ["20260926155247"] },
  { file: "0038_transferring_and_closed_from", recorded: "applied", versions: ["20260926183431"] },
  { file: "0039_advisors_messages_checkins", recorded: "applied", versions: ["20260927004656"] },
  { file: "0040_high_schools_and_notes", recorded: "applied", versions: ["20260927044402"] },
  { file: "0041_access_levels_and_titles", recorded: "applied", versions: ["20260927204910"] },
  { file: "0042_fit_net_cost", recorded: "applied", versions: ["20260927214948"] },
  { file: "0043_advisor_assigned_at", recorded: "applied", versions: ["20260927225349"] },
  { file: "0044_activity_log", recorded: "applied", versions: ["20260929230838"] },
  { file: "0045_doc_status_filed", recorded: "applied", versions: ["20260930042049"] },
  { file: "0046_assignments", recorded: "applied", versions: ["20260930042232"] },
  { file: "0048_document_vault", recorded: "applied", versions: [] },
  { file: "0049_member_photos", recorded: "applied", versions: ["20261010061309"] },
  { file: "0050_board_meetings", recorded: "applied", versions: ["20261010061607"] },
  { file: "0051_authority_log", recorded: "applied", versions: ["20261010164800"] },
  { file: "0052_close_needs_review_shelf", recorded: "applied", versions: ["20261010192408"] },
  { file: "0053_stub_reading_never_applied", recorded: "applied", versions: ["20261010201956"] },
  { file: "0054_document_filed_as", recorded: "applied", versions: ["20261010203055"] },
  { file: "0055_document_moves_back", recorded: "applied", versions: ["20261010235717"] },
  { file: "0056_checkin_photos", recorded: "applied", versions: ["20261011045058"] },
  { file: "0057_migration_status", recorded: "applied", versions: ["20261011045101"] },
  { file: "0058_document_athlete_link", recorded: "applied", versions: ["20261011184254"] },
  { file: "0059_doc_category_athlete_profile", recorded: "applied", versions: ["20261011231334"] },
  { file: "0060_doc_category_board_other", recorded: "applied", versions: ["20261011233921"] },
];
