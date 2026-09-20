import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { signout } from "@/lib/auth/actions";
import { labelForRole } from "@/lib/org/roleLabels";
import { Button, Form, Row, Screen, Section, Stack } from "@/components/kit";

// Everything that isn't Today/Athletes/Board: the modules, the reference
// data, who you are, and the way out.
export default async function MorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  return (
    <Screen title="More">
      <Section label="Work" role="contact" kind="checklist">
        {canEdit && <Row href={`/org/${slug}/documents`} kind="document" role="place" title="Documents" meta="Read a transcript or an offer letter into an athlete's record" wrap />}
        {org.modules.donor_fundraising && <Row href={`/org/${slug}/fundraising`} kind="money" role="committed" title="Fundraising" meta="Donors, gifts, pledges and the year against budget" wrap />}
        {org.modules.board_governance && <Row href={`/org/${slug}/board-governance`} kind="governance" role="people" title="Board" meta="Seats and give/get progress across every tier" wrap />}
      </Section>

      <Section label="Reference" role="target" kind="school">
        <Row href={`/org/${slug}/schools`} kind="school" role="place" title="Schools" meta="The shared database, and who you are recruiting" wrap />
        <Row href={`/org/${slug}/grading-scales`} kind="scale" role="contact" title="Grading Scales" meta="How each school's numbers become letters" wrap />
        <Row href={`/org/${slug}/approved-courses`} kind="checklist" role="visit" title="Approved Lists" meta="Which courses the NCAA counts at each school" wrap />
      </Section>

      <Section label="Organization" role="people" kind="people">
        {user.role === "owner" && <Row href={`/org/${slug}/members`} kind="people" role="people" title="Members" meta="Who can sign in, and what each person can do" wrap />}
        <Row kind="settings" role="neutral" title={user.full_name || user.email} meta={`${labelForRole(org.roleLabels, user.role)} at ${org.name}`} wrap />
        <Form action={signout}>
          <Stack gap={2}>
            <Button variant="destructive">Sign Out</Button>
          </Stack>
        </Form>
      </Section>
    </Screen>
  );
}
