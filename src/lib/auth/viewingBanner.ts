import { endViewAs } from "@/lib/actions/viewAs";
import { minutesLeft } from "@/lib/data/viewAs";
import type { ViewAsBannerProps } from "@/components/kit";

// What the View As banner needs, from whoever is viewing: the words, the
// minutes left, and Return bound to the organization being viewed. One
// place, so the org layout, the start and Not Authorized cannot say it
// three ways. Null when nobody is viewing, which is what Chrome and Panel
// take to mean "no banner".
export function viewingBanner(slug: string, v: { name: string; roleLabel: string; expiresAt: string } | null | undefined): ViewAsBannerProps | null {
  if (!v) return null;
  return { name: v.name, roleLabel: v.roleLabel, minutes: minutesLeft(v.expiresAt), action: endViewAs.bind(null, slug) };
}
