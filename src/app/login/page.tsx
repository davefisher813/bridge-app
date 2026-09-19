import { login, sendMagicLink } from "@/lib/auth/actions";
import { SignInForm } from "@/components/SignInForm";

// Placeholder styling: generic tokens from globals.css, not any one
// org's branding. Once a real org signs in, this screen should read
// that org's branding config (orgs.branding) rather than hardcode a
// look here - see docs/DESIGN_SYSTEM.md ("not yet decided").
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { error, mode } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        <div className="rounded-[18px] border border-line bg-paper p-6 shadow-sm">
          <SignInForm magicLink={sendMagicLink} password={login} initialError={error} startWithPassword={mode === "password"} />
        </div>

        <p className="mt-4 text-center text-[12.5px] text-muted">Accounts are created by your organization, not self-service.</p>
      </div>
    </main>
  );
}
