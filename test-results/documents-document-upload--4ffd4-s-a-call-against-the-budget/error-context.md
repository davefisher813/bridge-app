# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: documents.spec.ts >> document: upload, process, apply >> the reading shows up in Doc AI Spending as a call against the budget
- Location: e2e/documents.spec.ts:68:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('link', { name: /fall-transcript\.pdf/ }).first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('link', { name: /fall-transcript\.pdf/ }).first() with timeout 10000ms
  - waiting for getByRole('link', { name: /fall-transcript\.pdf/ }).first()

```

```yaml
- text: Fixture Foundation for Student Athletes
- main:
  - link "← More":
    - /url: /org/bridge-fixture/more
  - heading "Doc AI Spending" [level=1]
  - text: $0.01 of $20.00 this month, 1 call. An owner sets the budget under More. This Month 1
  - link "fixture.pdf · $0.01 Oct 3 · claude-opus-5 · 1500 tokens ›":
    - /url: /org/bridge-fixture/documents/00000000-0000-0000-0000-000000000111
- navigation "Main":
  - link "Today":
    - /url: /org/bridge-fixture
  - link "Athletes":
    - /url: /org/bridge-fixture/roster
  - link "Targets":
    - /url: /org/bridge-fixture/board
  - link "More":
    - /url: /org/bridge-fixture/more
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { ATHLETE, confirmWith, org, watchTraffic, type Traffic } from "./support/app";
  3  | import { readableTranscript, unreadableScan, type TestFile } from "./support/files";
  4  | 
  5  | // A document from upload to Apply. The browser sends the file straight to
  6  | // Storage (intercepted here), the server reads it back and runs the
  7  | // reading pipeline with the stand-in model, and an Admin applies what was
  8  | // read to the athlete. Nothing here calls an AI service: the fixture build
  9  | // has no SDK in it, and the tests assert that nothing left the app.
  10 | 
  11 | test.describe.configure({ mode: "serial" });
  12 | 
  13 | let traffic: Traffic;
  14 | test.beforeEach(async ({ page }) => {
  15 |   traffic = await watchTraffic(page);
  16 | });
  17 | test.afterEach(() => {
  18 |   expect(traffic.external, "nothing but the app's own origin and the stubbed upload").toEqual([]);
  19 | });
  20 | 
  21 | async function upload(page: import("@playwright/test").Page, f: TestFile, source: string) {
  22 |   await page.goto(org("/documents/new"));
  23 |   await expect(page.getByRole("heading", { name: "Add a Document" })).toBeVisible();
  24 |   await page.getByRole("button", { name: "Transcript", exact: true }).click();
  25 |   await page.locator("select").first().selectOption({ label: source });
  26 |   await page.setInputFiles("input[name=files]", f);
  27 |   await page.getByRole("button", { name: "Read Document" }).click();
  28 | }
  29 | 
  30 | test.describe("document: upload, process, apply", () => {
  31 |   test("a parent's transcript is read, held for review, applied, and can be undone", async ({ page }) => {
  32 |     await upload(page, readableTranscript(), "A parent sent it");
  33 | 
  34 |     // Processed: it lands on review, matched to the athlete, with what it read.
  35 |     await expect(page.getByRole("heading", { name: "Check This Before It Lands" })).toBeVisible();
  36 |     await expect(page.getByText("Needs Review")).toBeVisible();
  37 |     await expect(page.getByText("Fixture Athlete")).toBeVisible();
  38 |     await expect(page.getByText("3.88")).toBeVisible();
  39 |     await expect(page.getByText(/not enough to change an athlete without a look/i)).toBeVisible();
  40 |     // The file went to the org's own folder, once.
  41 |     expect(traffic.uploads).toHaveLength(1);
  42 |     expect(traffic.uploads[0]).toMatch(/^POST \/storage\/v1\/object\/documents\/00000000-0000-0000-0000-0000000000a1\/doc_[\w-]+\/1-fall-transcript\.pdf$/);
  43 | 
  44 |     // Applied: the athlete now carries it.
  45 |     await page.getByRole("button", { name: "Apply", exact: true }).click();
  46 |     await expect(page.getByRole("heading", { name: "Transcript read" })).toBeVisible();
  47 |     await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  48 |     await page.goto(org(`/roster/${ATHLETE}`));
  49 |     await expect(page.getByText(/3\.88/).first()).toBeVisible();
  50 | 
  51 |     // Undone: the document is discarded and the athlete is put back.
  52 |     await page.goto(org("/documents"));
  53 |     await page.getByRole("link", { name: /Transcript · Fixture Athlete[\s\S]*fall-transcript\.pdf/ }).first().click();
  54 |     await confirmWith(page, "Undo and Discard", "Undo and Discard");
  55 |     await page.goto(org(`/roster/${ATHLETE}`));
  56 |     await expect(page.getByText(/3\.88/)).toHaveCount(0);
  57 |   });
  58 | 
  59 |   test("an unreadable scan is refused before anything is read, and no athlete is touched", async ({ page }) => {
  60 |     await upload(page, unreadableScan(), "A parent sent it");
  61 |     await expect(page.getByRole("heading", { name: "Could Not Use This" })).toBeVisible();
  62 |     await expect(page.getByText("Not Used")).toBeVisible();
  63 |     await expect(page.getByText(/too blurry to read reliably/i).first()).toBeVisible();
  64 |     await expect(page.getByText("Nothing was changed on any athlete.")).toBeVisible();
  65 |     await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  66 |   });
  67 | 
  68 |   test("the reading shows up in Doc AI Spending as a call against the budget", async ({ page }) => {
  69 |     await upload(page, readableTranscript(), "A parent sent it");
  70 |     await expect(page.getByRole("heading", { name: "Check This Before It Lands" })).toBeVisible();
  71 |     await page.goto(org("/doc-ai-spending"));
  72 |     await expect(page.getByRole("heading", { name: "Doc AI Spending" })).toBeVisible();
  73 |     await expect(page.getByText(/of \$20\.00 this month/)).toBeVisible();
> 74 |     await expect(page.getByRole("link", { name: /fall-transcript\.pdf/ }).first()).toBeVisible();
     |                                                                                    ^ Error: expect(locator).toBeVisible() failed
  75 |   });
  76 | 
  77 |   test("a Viewer and an Athlete login cannot open the upload screen", async ({ page, context, baseURL }) => {
  78 |     for (const who of ["00000000-0000-0000-0000-0000000000b2", "00000000-0000-0000-0000-0000000000b5"]) {
  79 |       await context.clearCookies();
  80 |       await context.addCookies([{ name: "fixture_user", value: who, url: baseURL! }]);
  81 |       const res = await page.goto(org("/documents/new"));
  82 |       expect(res?.status() ?? 200).toBeLessThan(500);
  83 |       await expect(page.getByRole("heading", { name: "Add a Document" })).toHaveCount(0);
  84 |     }
  85 |   });
  86 | });
  87 | 
```