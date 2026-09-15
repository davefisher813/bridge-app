import { z } from "zod";

// orgs.modules is a jsonb feature-toggle map (see migrations/0001_core_schema.sql).
// recruiting and doc_ai are core, on for every org unless the row says
// otherwise; board_governance and donor_fundraising exist for Bridge and
// default off. Parsed the same way athletes.detail and schools' jsonb
// columns are: Postgres validates ownership, this validates shape.
const orgModulesSchema = z
  .object({
    recruiting: z.boolean().catch(true),
    doc_ai: z.boolean().catch(true),
    board_governance: z.boolean().catch(false),
    donor_fundraising: z.boolean().catch(false),
  })
  .catch({ recruiting: true, doc_ai: true, board_governance: false, donor_fundraising: false });

export type OrgModules = z.infer<typeof orgModulesSchema>;

export function parseOrgModules(raw: unknown): OrgModules {
  return orgModulesSchema.parse(raw);
}
