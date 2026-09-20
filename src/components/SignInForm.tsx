"use client";

import { useActionState, useState } from "react";
import type { MagicLinkState } from "@/lib/auth/actions";
import { Button, Field, Form, Heading, Hidden, Notice, Prose, Stack } from "@/components/kit";

type MagicLinkAction = (prevState: MagicLinkState, formData: FormData) => Promise<MagicLinkState>;
type PasswordAction = (formData: FormData) => Promise<void>;

const EMPTY: MagicLinkState = { sent: false, email: "", error: null };

// Email and password on one screen, the link one tap under it. Dave's
// pick in the clean slate audit (2026-09-19), after a day of dead links.
export function SignInForm({ magicLink, password, initialError, startWithLink = false }: { magicLink: MagicLinkAction; password: PasswordAction; initialError?: string; startWithLink?: boolean }) {
  const [state, sendLink, pending] = useActionState(magicLink, EMPTY);
  const [useLink, setUseLink] = useState(startWithLink);

  if (state.sent) {
    return (
      <Stack gap={4}>
        <div>
          <Heading>Check your email</Heading>
          <Prose>
            A link went to <b>{state.email}</b>. Open it on this phone and you are in.
          </Prose>
        </div>
        <Form action={sendLink}>
          <Hidden name="email" value={state.email} />
          <Button variant="secondary" disabled={pending}>
            {pending ? "Sending..." : "Send it again"}
          </Button>
        </Form>
        <Button type="button" variant="quiet" onClick={() => window.location.assign("/login")}>
          Start over
        </Button>
      </Stack>
    );
  }

  if (useLink) {
    return (
      <Stack gap={4}>
        <div>
          <Heading>Sign in</Heading>
          <Prose>Enter your email. A sign-in link comes back in a minute.</Prose>
        </div>
        {(state.error || initialError) && <Notice tone="danger" title={state.error ?? initialError} />}
        <Form action={sendLink}>
          <Field name="email" label="Email" type="email" required autoComplete="email" inputMode="email" defaultValue={state.email} onPaper />
          <Button disabled={pending}>{pending ? "Sending..." : "Email Me a Link"}</Button>
        </Form>
        <Button type="button" variant="quiet" onClick={() => setUseLink(false)}>
          Use a password instead
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <div>
        <Heading>Sign in</Heading>
        <Prose>The email and password your organization set up for you.</Prose>
      </div>
      {initialError && <Notice tone="danger" title={initialError} />}
      <Form action={password}>
        <Field name="email" label="Email" type="email" required autoComplete="email" inputMode="email" defaultValue={state.email} onPaper />
        <Field name="password" label="Password" type="password" required autoComplete="current-password" onPaper />
        <Button>Sign In</Button>
      </Form>
      <Button type="button" variant="quiet" onClick={() => setUseLink(true)}>
        Email me a link instead
      </Button>
    </Stack>
  );
}
