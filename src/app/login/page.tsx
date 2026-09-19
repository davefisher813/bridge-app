import { login, sendMagicLink } from "@/lib/auth/actions";
import { SignInForm } from "@/components/SignInForm";
import { Label, Panel, Stack } from "@/components/kit";

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
    <Panel>
      <Stack gap={6}>
        <SignInForm magicLink={sendMagicLink} password={login} initialError={error} startWithLink={mode === "link"} />
        <div className="text-center">
          <Label>Accounts are created by your organization, not self-service.</Label>
        </div>
      </Stack>
    </Panel>
  );
}
