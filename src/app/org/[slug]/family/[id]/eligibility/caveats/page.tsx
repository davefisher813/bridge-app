// The same screen staff open under the roster, served under /family so
// the family tab bar stays and every link stays inside the family's
// screens. The page itself checks the role and builds its links from
// athleteHome() in src/lib/auth/guard.ts.
export { default } from "@/app/org/[slug]/roster/[id]/eligibility/caveats/page";
export const dynamic = "force-dynamic";
