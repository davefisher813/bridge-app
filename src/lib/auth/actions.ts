"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/auth/origin";

// Self-registration is disabled, same as tucci-admin: this is a
// multi-tenant tool where accounts are created by an org owner (a
// Bridge coordinator's account exists because Dave or another Bridge
// owner created it, not because anyone can sign up), never open signup.
export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export interface MagicLinkState {
  sent: boolean;
  email: string;
  error: string | null;
}

// The default way in. Nobody invited to an org ever sets a password:
// they type their email, a link comes back, tapping it signs them in
// through /auth/callback. shouldCreateUser is off because accounts are
// created by an org owner, never by whoever types an address here.
//
// An unknown address is told so. The first version showed "check your
// email" for any address so the form could not be used to learn which
// ones exist; Dave then spent twenty minutes waiting for an email to an
// address that was not the account (2026-09-19). This is a closed
// system with accounts handed out by an owner, and a person locked out
// of it needs the true reason more than a stranger needs to be denied
// a yes-or-no.
export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, email, error: "Enter the email your organization set up for you." };
  }
  const supabase = await createClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
  });
  if (error) {
    if (/signups not allowed|user not found|otp_disabled/i.test(error.message)) {
      return { sent: false, email, error: `There is no account for ${email}. Check the spelling, or ask your organization's owner to invite you.` };
    }
    return { sent: false, email, error: error.message };
  }
  return { sent: true, email, error: null };
}

export async function signout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
