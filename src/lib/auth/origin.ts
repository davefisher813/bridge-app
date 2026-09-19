import { headers } from "next/headers";

// Where this deployment lives, for links that leave the app and come
// back: the magic link and the invitation email. NEXT_PUBLIC_SITE_URL
// wins when set, so a preview deployment can still send people to
// production; otherwise the request's own host, which on Vercel is the
// forwarded one.
export async function siteOrigin(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
