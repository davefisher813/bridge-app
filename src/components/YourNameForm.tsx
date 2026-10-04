import { renameSelfForm } from "@/lib/actions/members";
import { Button, Field, Form, Hidden, Stack } from "@/components/kit";

// Your own name, on the More screen of each version of the app (audit
// crud F17). The action checks you are in the org and writes only your
// own row; returnTo brings you back to the screen you were on.
export function YourNameForm({ slug, returnTo, fullName }: { slug: string; returnTo: string; fullName: string }) {
  return (
    <Form action={renameSelfForm.bind(null, slug)}>
      <Stack gap={3}>
        <Hidden name="returnTo" value={returnTo} />
        <Field id="your-name" name="fullName" label="Your Name" defaultValue={fullName} autoComplete="name" maxLength={120} />
        <Button variant="secondary">Save Name</Button>
      </Stack>
    </Form>
  );
}
