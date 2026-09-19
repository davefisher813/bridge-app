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
// created by an org owner, never by whoever types an address here; an
// unknown address gets the same "check your email" screen as a known
// one, so the form does not confirm which addresses have accounts.
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
  if (error && !/signups not allowed|user not found/i.test(error.message)) {
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
