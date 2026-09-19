import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Where a magic link, an invitation or a recovery email lands. Two
// shapes arrive here depending on how the Supabase email template is
// written:
//
//   ?token_hash=...&type=magiclink   the template links straight here
//   ?code=...                        Supabase verified it first (PKCE)
//
// The first is the one to use. PKCE needs the browser that asked for
// the link to be the browser that opens it, and on an iPhone a link
// tapped in Mail opens Safari, not the installed app that asked. A
// token hash works from anywhere. Both are handled so the callback is
// right whichever template the project has.

const OTP_TYPES: EmailOtpType[] = ["magiclink", "invite", "recovery", "email", "signup", "email_change"];

function safeNext(value: string | null): string {
  // Only a path on this site. A full URL here would make the callback an
  // open redirect for anyone who could get a person to tap a link.
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  const supabase = await createClient();
  let failed = true;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = !!error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = !!error;
  }

  if (failed) {
    const message = "That sign-in link is not valid any more. Ask for a new one.";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
