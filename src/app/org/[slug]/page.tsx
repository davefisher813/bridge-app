import { redirect } from "next/navigation";

// The org landing has nothing of its own yet (that would be a dashboard,
// not built - see docs/ROADMAP.md); roster is the only real screen so
// far, so this just forwards there.
export default async function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/org/${slug}/roster`);
}
