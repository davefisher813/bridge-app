import { login, sendMagicLink } from "@/lib/auth/actions";
import { SignInForm } from "@/components/SignInForm";

// Placeholder styling: generic tokens from globals.css, not any one
// org's branding. Once a real org signs in, this screen should read
// that org's branding config (orgs.branding) rather than hardcode a
// look here - see docs/DESIGN_SYSTEM.md ("not yet decided").
// Supabase sends a failed email link back here with its own codes in the
// query string. Those are for a developer; the person reading the screen
// gets told what to do instead.
function plainError(error?: string, code?: string, description?: string): string | undefined {
  if (!error && !code) return undefined;
  if (code === "otp_expired" || /expired|invalid/i.test(description ?? "") || error === "access_denied") {
    return "That sign-in link has expired or was already used. Ask for a new one, or use a password.";
  }
  return description || error;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; error_code?: string; error_description?: string; mode?: string }>;
}) {
  const { error: rawError, error_code, error_description, mode } = await searchParams;
  const error = plainError(rawError, error_code, error_description);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        <div className="rounded-[18px] border border-line bg-paper p-6 shadow-sm">
          <SignInForm magicLink={sendMagicLink} password={login} initialError={error} startWithPassword={mode !== "link"} />
        </div>

        <p className="mt-4 text-center text-[12.5px] text-muted">Accounts are created by your organization, not self-service.</p>
      </div>
    </main>
  );
}
