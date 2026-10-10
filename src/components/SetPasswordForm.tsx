import { setPasswordForm } from "@/lib/auth/actions";
import { Button, Field, Form, Stack } from "@/components/kit";

// Set or change your own password, on the More screen. With "Email Me a
// Link" on the sign-in screen this is the whole forgot-password path:
// sign in with the link, set a new password here.
export function SetPasswordForm({ returnTo }: { returnTo: string }) {
  return (
    <Form action={setPasswordForm.bind(null, returnTo)}>
      <Stack gap={3}>
        <Field id="new-password" name="password" label="New Password" type="password" autoComplete="new-password" minLength={8} required />
        <Field id="confirm-password" name="confirm" label="Type It Again" type="password" autoComplete="new-password" minLength={8} required />
        <Button variant="secondary">Set Password</Button>
      </Stack>
    </Form>
  );
}
