import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createTarget } from "@/lib/actions/targets";
import { TargetForm } from "@/components/TargetForm";

export default async function NewTargetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athleteRows }, { data: schoolRows }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("schools").select("id, name, division").order("name"),
  ]);

  const athletes = (athleteRows ?? []).map((a) => ({ id: a.id, label: a.name }));
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));

  const action = createTarget.bind(null, slug);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/board`} className="text-[13px] font-bold text-muted">
          &larr; Board
        </Link>
      </div>
      <h1 className="mb-4 text-[20px] font-extrabold text-ink">Add target</h1>

      {athletes.length === 0 ? (
        <div className="rounded-[16px] border border-line bg-paper px-4 py-6 text-center text-[13px] text-muted">
          No athletes on the roster yet.{" "}
          <Link href={`/org/${slug}/roster/new`} className="font-bold text-accent">
            Add one first
          </Link>
          .
        </div>
      ) : schools.length === 0 ? (
        <div className="rounded-[16px] border border-line bg-paper px-4 py-6 text-center text-[13px] text-muted">
          No schools in the reference database yet. Schools are shared across every org and aren't editable from this screen -
          see docs/ARCHITECTURE.md for why. Ask Dave how school data should get in.
        </div>
      ) : (
        <TargetForm action={action} athletes={athletes} schools={schools} submitLabel="Add target" />
      )}
    </main>
  );
}
