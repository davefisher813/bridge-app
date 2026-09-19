"use client";

import { useActionState, useState } from "react";
import type { MagicLinkState } from "@/lib/auth/actions";
import { errorClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

type MagicLinkAction = (prevState: MagicLinkState, formData: FormData) => Promise<MagicLinkState>;
type PasswordAction = (formData: FormData) => Promise<void>;

const EMPTY: MagicLinkState = { sent: false, email: "", error: null };

// Magic link by default; a password only for an account that has one.
// Approved from the preview 2026-09-19. The sent state stays on the
// same panel so the address is still on screen to check.
export function SignInForm({
  magicLink,
  password,
  initialError,
  // Password first. The magic link needs an email template, a URL
  // allowlist and a fresh link every time; the password needs none of
  // that, and it is what got Dave in on 2026-09-19 after two hours of
  // dead links. The link is one tap away for everyone invited later.
  startWithPassword = true,
}: {
  magicLink: MagicLinkAction;
  password: PasswordAction;
  initialError?: string;
  startWithPassword?: boolean;
}) {
  const [state, sendLink, pending] = useActionState(magicLink, EMPTY);
  const [usePassword, setUsePassword] = useState(startWithPassword);

  if (state.sent) {
    return (
      <div className="text-center">
        <div className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">Check your email</div>
        <div className="mt-1 text-[14.5px] text-muted">
          A link went to <b className="text-ink">{state.email}</b>. Open it on this phone and you are in.
        </div>
        <form action={sendLink} className="mt-4">
          <input type="hidden" name="email" value={state.email} />
          <button type="submit" disabled={pending} className="text-[14.5px] font-semibold text-accent">
            {pending ? "Sending..." : "Send it again"}
          </button>
        </form>
        <p className="mt-4 text-[12.5px] text-muted">
          Wrong address?{" "}
          <a href="/login" className="font-bold text-accent">
            Start over
          </a>
        </p>
      </div>
    );
  }

  if (usePassword) {
    return (
      <>
        <div className="mb-5">
          <div className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">Sign in</div>
          <div className="mt-1 text-[14.5px] text-muted">Enter the email and password your organization set up for you.</div>
        </div>
        {initialError && <p className={`${errorClass} mb-3`}>{initialError}</p>}
        <form action={password} className="flex flex-col gap-4">
          <div>
            <label className={labelClass} htmlFor="email">
              Email
            </label>
            <input className={inputClass} id="email" name="email" type="email" required autoComplete="email" defaultValue={state.email} />
          </div>
          <div>
            <label className={labelClass} htmlFor="password">
              Password
            </label>
            <input className={inputClass} id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button type="submit" className={submitClass}>
            Sign In
          </button>
        </form>
        <button type="button" onClick={() => setUsePassword(false)} className="mt-3 w-full py-2.5 text-center text-[14.5px] font-semibold text-accent">
          Email me a link instead
        </button>
      </>
    );
  }

  return (
    <>
      <div className="mb-5">
        <div className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">Sign in</div>
        <div className="mt-1 text-[14.5px] text-muted">Enter your email. A sign-in link comes back in a minute.</div>
      </div>
      {(state.error || initialError) && <p className={`${errorClass} mb-3`}>{state.error ?? initialError}</p>}
      <form action={sendLink} className="flex flex-col gap-4">
        <div>
          <label className={labelClass} htmlFor="email">
            Email
          </label>
          <input className={inputClass} id="email" name="email" type="email" required autoComplete="email" inputMode="email" defaultValue={state.email} />
        </div>
        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? "Sending..." : "Email Me a Link"}
        </button>
      </form>
      <button type="button" onClick={() => setUsePassword(true)} className="mt-3 w-full py-2.5 text-center text-[14.5px] font-semibold text-accent">
        Use a password instead
      </button>
    </>
  );
}
