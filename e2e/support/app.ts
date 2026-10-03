import { expect, type Page, type Request } from "@playwright/test";

// The fixture org with every module on, and its one fully-featured athlete
// (src/testing/fixture.ts). The server keeps what the tests write, so
// anything a test creates is named with unique() to stay out of the way.
export const ORG = "bridge-fixture";
export const ATHLETE = "00000000-0000-0000-0000-0000000000c1";
export const org = (path = "") => `/org/${ORG}${path}`;

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix} ${Date.now().toString(36)}${counter}`;
}

export interface Traffic {
  // Uploads the browser tried to send to Storage (intercepted, not sent).
  uploads: string[];
  // Every request that left the app's own origin, other than those uploads.
  external: string[];
}

// Watches a page for the two things these tests promise: the Storage
// upload is stood in for, and nothing else leaves the app (in particular
// nothing reaches Anthropic).
export async function watchTraffic(page: Page): Promise<Traffic> {
  const traffic: Traffic = { uploads: [], external: [] };
  const origin = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3120}`).origin;
  await page.route("**/storage/v1/object/**", async (route) => {
    traffic.uploads.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "documents/stub", Id: "stub" }) });
  });
  page.on("request", (r: Request) => {
    const url = new URL(r.url());
    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.pathname.startsWith("/storage/v1/object/")) return;
    traffic.external.push(r.url());
  });
  return traffic;
}

// A confirm dialog the kit raises for anything destructive: click the
// button that opens it, then the one inside it that goes ahead.
export async function confirmWith(page: Page, opener: string | RegExp, confirmLabel: string) {
  await page.getByRole("button", { name: opener }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
}

export async function noticeIs(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();
}
