import { login } from "@/lib/auth/actions";

// Placeholder styling: generic tokens from globals.css, not any one
// org's branding. Once a real org signs in, this screen should read
// that org's branding config (orgs.branding) rather than hardcode a
// look here - see docs/DESIGN_SYSTEM.md ("not yet decided").
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        <div className="rounded-[18px] border border-line bg-paper p-6 shadow-sm">
          <div className="mb-5">
            <div className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">Sign in</div>
            <div className="mt-1 text-[14.5px] text-muted">Enter the email and password your organization set up for you.</div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[14.5px] text-danger">
              {error}
            </div>
          )}

          <form action={login} className="flex flex-col gap-4">
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold text-muted">Email</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-[10px] border-0 bg-bg px-3 py-2.5 text-[16px] text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold text-muted">Password</label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="rounded-[10px] border-0 bg-bg px-3 py-2.5 text-[16px] text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <button type="submit" className="mt-1 rounded-[8px] bg-solid-accent py-[13px] text-[15px] font-extrabold tracking-[0.02em] text-solid-accent-on">
              Sign In
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[12.5px] text-muted">Accounts are created by your organization, not self-service.</p>
      </div>
    </main>
  );
}
