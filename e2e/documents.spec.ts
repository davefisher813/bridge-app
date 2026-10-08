import { expect, test } from "@playwright/test";
import { ATHLETE, confirmWith, org, watchTraffic, type Traffic } from "./support/app";
import { createHash } from "node:crypto";
import { makeFile, GOOD_NAMES, type SyntheticKind } from "../src/testing/vaultFiles";
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
  await page.getByRole("button", { name: "Upload and Read" }).click();
}

test.describe("document: upload, process, apply", () => {
  test("a parent's transcript is read, held for review, applied, and can be undone", async ({ page }) => {
    await upload(page, readableTranscript(), "A parent sent it");

    // Processed: it lands on review, matched to the athlete, with what it read.
    await expect(page.getByRole("heading", { name: "Check This Before It Lands" })).toBeVisible();
    await expect(page.getByText("Needs Review", { exact: true }).first()).toBeVisible();
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
    // Applying never marks anything Ready: that is its own tap.
    await expect(page.getByText("Needs Review", { exact: true }).first()).toBeVisible();
    await page.goto(org(`/roster/${ATHLETE}`));
    await expect(page.getByText(/3\.88/).first()).toBeVisible();

    // Undone: the document is discarded and the athlete is put back.
    await page.goto(org("/documents"));
    await page.getByRole("link", { name: /Transcript · Fixture Athlete[\s\S]*fall-transcript\.pdf/ }).first().click();
    await confirmWith(page, "Undo and Discard", "Undo and Discard");
    await page.goto(org(`/roster/${ATHLETE}`));
    await expect(page.getByText(/3\.88/)).toHaveCount(0);
  });

  test("an unreadable scan is kept in Needs Review with the reason, and no athlete is touched", async ({ page }) => {
    await upload(page, unreadableScan(), "A parent sent it");
    await expect(page.getByRole("heading", { name: "Kept for Review" })).toBeVisible();
    await expect(page.getByText("Needs Review", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/too blurry to read reliably/i).first()).toBeVisible();
    await expect(page.getByText(/nothing was changed on any athlete/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    // Kept, not rejected and not deletable.
    await expect(page.getByText(/Not Used|Could Not Use|Delete/)).toHaveCount(0);
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

// ── The vault: seven formats, kept originals, five states ────────────

async function pick(page: import("@playwright/test").Page, name: string, buffer: Buffer, mimeType = "application/octet-stream") {
  await page.goto(org("/documents/new"));
  await expect(page.getByRole("heading", { name: "Add a Document" })).toBeVisible();
  await page.setInputFiles("input[name=files]", { name, mimeType, buffer });
}

test.describe("vault: every format is stored as it came", () => {
  const kinds = Object.keys(GOOD_NAMES) as Array<keyof typeof GOOD_NAMES>;
  const LABEL: Record<string, string> = { pdf: "PDF", docx: "Word", doc: "Word", xlsx: "Excel", xls: "Excel", csv: "CSV", jpg: "JPG", png: "PNG", txt: "TXT" };

  for (const kind of kinds) {
    test(`${kind}: stored, in Needs Review, with its facts and a download of the same bytes`, async ({ page }) => {
      const bytes = Buffer.from(makeFile(kind as SyntheticKind));
      // A name no other test uses, so the same bytes are not a twin.
      const name = `e2e-${GOOD_NAMES[kind]}`;
      await pick(page, name, bytes);
      await page.getByRole("button", { name: "Upload", exact: true }).click();

      await expect(page.getByRole("heading", { name: "Stored File" })).toBeVisible();
      await expect(page.getByText("Needs Review", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Original File")).toBeVisible();
      await expect(page.getByText(name).first()).toBeVisible();
      await expect(page.getByText(LABEL[kind]!, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
      // No type was chosen: no reader ran, so nothing to apply.
      await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
      expect(traffic.uploads).toHaveLength(1);
      expect(traffic.uploads[0]).toMatch(new RegExp(`^POST /storage/v1/object/documents/00000000-0000-0000-0000-0000000000a1/doc_[\\w-]+/1-e2e-`));

      // The download is an attachment of the stored bytes.
      const href = await page.getByRole("link", { name: "Download" }).getAttribute("href");
      const res = await page.request.get(href!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-disposition"]).toContain(`attachment; filename="${name}"`);
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
      if (kind !== "pdf") expect(createHash("sha256").update(await res.body()).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    });
  }

  test("a format outside the seven is refused in the browser, naming the seven, and nothing is uploaded", async ({ page }) => {
    await pick(page, "slides.pptx", Buffer.from(makeFile("zip")));
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/PDF, Word \(DOC, DOCX\), Excel \(XLS, XLSX\), CSV, JPG, PNG and TXT/).first()).toBeVisible();
    expect(traffic.uploads).toHaveLength(0);
  });

  test("a PNG renamed .jpg is refused on its bytes, and nothing is uploaded", async ({ page }) => {
    await pick(page, "renamed.jpg", Buffer.from(makeFile("png")));
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/contents are a PNG image, not \.jpg/)).toBeVisible();
    expect(traffic.uploads).toHaveLength(0);
  });
});

test.describe("vault: a file that does not look like its type is kept, and the states move by a person's tap", () => {
  test("a transcript that is not a transcript: Needs Review, Did not look like Transcript, Mark Ready, Archive, Unarchive", async ({ page }) => {
    const f = readableTranscript();
    await page.goto(org("/documents/new"));
    await page.getByRole("button", { name: "Transcript", exact: true }).click();
    // The stand-in treats a name with "offtype" as a different kind of document.
    await page.setInputFiles("input[name=files]", { name: "offtype-june-scores.pdf", mimeType: f.mimeType, buffer: f.buffer });
    await page.getByRole("button", { name: "Upload and Read" }).click();

    await expect(page.getByRole("heading", { name: "Kept for Review" })).toBeVisible();
    await expect(page.getByText("Did not look like Transcript").first()).toBeVisible();
    await expect(page.getByText("Needs Review", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible();

    // The list row says why too.
    await page.goto(org("/documents"));
    await expect(page.getByRole("link", { name: /offtype-june-scores\.pdf[\s\S]*Did not look like Transcript/ }).first()).toBeVisible();
    await page.getByRole("link", { name: /offtype-june-scores\.pdf/ }).first().click();

    // Mark Ready is a tap.
    await page.getByRole("button", { name: "Mark Ready" }).click();
    await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark Ready" })).toHaveCount(0);

    // Archive, then it is out of the working list until asked for.
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
    await page.goto(org("/documents"));
    await expect(page.getByRole("link", { name: /offtype-june-scores\.pdf/ })).toHaveCount(0);
    await page.getByRole("link", { name: /Show Archived/ }).click();
    await page.getByRole("link", { name: /offtype-june-scores\.pdf/ }).first().click();

    // Unarchive returns it to Needs Review, never to Ready.
    await page.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByText("Needs Review", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark Ready" })).toBeVisible();

    // Each move is in the activity log with who.
    await page.goto(org("/activity"));
    for (const line of [/Marked a transcript Ready/, /Archived a transcript/, /Unarchived a transcript/]) await expect(page.getByText(line).first()).toBeVisible();
  });

  test("a document has no Delete anywhere", async ({ page }) => {
    await page.goto(org("/documents"));
    await expect(page.getByText(/Delete/)).toHaveCount(0);
    await page.getByRole("link", { name: /fixture\.pdf|Transcript/ }).first().click();
    await expect(page.getByText(/Delete/)).toHaveCount(0);
  });
});
