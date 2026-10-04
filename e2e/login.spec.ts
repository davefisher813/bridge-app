import { expect, test } from "@playwright/test";
import { org } from "./support/app";

// Magic-link sign-in, from the screen a person sees to the page they land
// on. The email itself and the session cookie are Supabase's; what is under
// test is everything the app does around them: asking for the link, what it
// says afterwards, what the link's landing route does with a good link, a
// dead one and a hostile one.

test.describe("sign in with a magic link", () => {
  test("asks for an email, says where the link went, and lets you start over", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();

    await page.getByRole("button", { name: "Email Me a Link Instead" }).click();
    await page.getByLabel("Email").fill("owner@example.test");
    await page.getByRole("button", { name: "Email Me a Link", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Check Your Email" })).toBeVisible();
    await expect(page.getByText("A link went to owner@example.test.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send It Again" })).toBeVisible();

    // Back to the start: the sign-in form, with the way to ask for a link again.
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Email Me a Link Instead" })).toBeVisible();
  });

  test("the password form is still the default, with a way across to the link", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Email Me a Link Instead" }).click();
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("a good link lands on the page it was for", async ({ page }) => {
    await page.goto(`/auth/callback?token_hash=good&type=magiclink&next=${encodeURIComponent(org("/more"))}`);
    await expect(page).toHaveURL(new RegExp(`${org("/more")}$`));
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  });

  test("a good link with nowhere to go lands on the org picker", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=good&type=magiclink");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Choose an Organization" })).toBeVisible();
  });

  test("an expired link comes back to sign-in with a plain sentence, not a code", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=expired&type=magiclink");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByText("That sign-in link is not valid any more. Ask for a new one.")).toBeVisible();
    await expect(page.getByText(/otp_expired|invalid_grant|token/i)).toHaveCount(0);
  });

  test("a link with no token at all is refused the same way", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByText("That sign-in link is not valid any more.")).toBeVisible();
  });

  test("a link cannot be used to send someone to another site", async ({ page }) => {
    for (const next of ["//evil.example/phish", "https://evil.example/phish", "javascript:alert(1)"]) {
      await page.goto(`/auth/callback?token_hash=good&type=magiclink&next=${encodeURIComponent(next)}`);
      expect(new URL(page.url()).origin).toBe(new URL(process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3120}`).origin);
      await expect(page.getByRole("heading", { name: "Choose an Organization" })).toBeVisible();
    }
  });
});
