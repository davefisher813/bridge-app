import { expect, test } from "@playwright/test";
import { ATHLETE, confirmWith, org, watchTraffic, type Traffic } from "./support/app";
import { readableTranscript, unreadableScan, type TestFile } from "./support/files";

// A document from upload to Apply. The browser sends the file straight to
// Storage (intercepted here), the server reads it back and runs the
// reading pipeline with the stand-in model, and an Admin applies what was
// read to the athlete. Nothing here calls an AI service: the fixture build
// has no SDK in it, and the tests assert that nothing left the app.

test.describe.configure({ mode: "serial" });

let traffic: Traffic;
test.beforeEach(async ({ page }) => {
  traffic = await watchTraffic(page);
});
test.afterEach(() => {
  expect(traffic.external, "nothing but the app's own origin and the stubbed upload").toEqual([]);
});

async function upload(page: import("@playwright/test").Page, f: TestFile, source: string) {
  await page.goto(org("/documents/new"));
  await expect(page.getByRole("heading", { name: "Add a Document" })).toBeVisible();
  await page.getByRole("button", { name: "Transcript", exact: true }).click();
  await page.locator("select").first().selectOption({ label: source });
  await page.setInputFiles("input[name=files]", f);
  await page.getByRole("button", { name: "Read Document" }).click();
}

test.describe("document: upload, process, apply", () => {
  test("a parent's transcript is read, held for review, applied, and can be undone", async ({ page }) => {
    await upload(page, readableTranscript(), "A parent sent it");

    // Processed: it lands on review, matched to the athlete, with what it read.
    await expect(page.getByRole("heading", { name: "Check This Before It Lands" })).toBeVisible();
    await expect(page.getByText("Needs Review")).toBeVisible();
    await expect(page.getByText("Fixture Athlete")).toBeVisible();
    await expect(page.getByText("3.88")).toBeVisible();
    await expect(page.getByText(/not enough to change an athlete without a look/i)).toBeVisible();
    // The file went to the org's own folder, once.
    expect(traffic.uploads).toHaveLength(1);
    expect(traffic.uploads[0]).toMatch(/^POST \/storage\/v1\/object\/documents\/00000000-0000-0000-0000-0000000000a1\/doc_[\w-]+\/1-fall-transcript\.pdf$/);

    // Applied: the athlete now carries it.
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Transcript read" })).toBeVisible();
    await expect(page.getByText("Applied", { exact: true })).toBeVisible();
    await page.goto(org(`/roster/${ATHLETE}`));
    await expect(page.getByText(/3\.88/).first()).toBeVisible();

    // Undone: the document is discarded and the athlete is put back.
    await page.goto(org("/documents"));
    await page.getByRole("link", { name: /Transcript · Fixture Athlete[\s\S]*fall-transcript\.pdf/ }).first().click();
    await confirmWith(page, "Undo and Discard", "Undo and Discard");
    await page.goto(org(`/roster/${ATHLETE}`));
    await expect(page.getByText(/3\.88/)).toHaveCount(0);
  });

  test("an unreadable scan is refused before anything is read, and no athlete is touched", async ({ page }) => {
    await upload(page, unreadableScan(), "A parent sent it");
    await expect(page.getByRole("heading", { name: "Could Not Use This" })).toBeVisible();
    await expect(page.getByText("Not Used")).toBeVisible();
    await expect(page.getByText(/too blurry to read reliably/i).first()).toBeVisible();
    await expect(page.getByText("Nothing was changed on any athlete.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  });

  test("the reading shows up in Doc AI Spending as a call against the budget", async ({ page }) => {
    await upload(page, readableTranscript(), "A parent sent it");
    await expect(page.getByRole("heading", { name: "Check This Before It Lands" })).toBeVisible();
    await page.goto(org("/doc-ai-spending"));
    await expect(page.getByRole("heading", { name: "Doc AI Spending" })).toBeVisible();
    await expect(page.getByText(/of \$20\.00 this month/)).toBeVisible();
    await expect(page.getByRole("link", { name: /fall-transcript\.pdf/ }).first()).toBeVisible();
  });

  test("a Viewer and an Athlete login cannot open the upload screen", async ({ page, context, baseURL }) => {
    for (const who of ["00000000-0000-0000-0000-0000000000b2", "00000000-0000-0000-0000-0000000000b5"]) {
      await context.clearCookies();
      await context.addCookies([{ name: "fixture_user", value: who, url: baseURL! }]);
      const res = await page.goto(org("/documents/new"));
      expect(res?.status() ?? 200).toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "Add a Document" })).toHaveCount(0);
    }
  });
});
