#!/usr/bin/env node
// The Doc AI Piece 1 walk: the vault at phone width, light and dark, as
// screenshots. One upload per format, a file that does not look like its
// type, Mark Ready, Archive, Unarchive, and a transcript through the
// existing reader.
//
// It drives the fixture app (scripts/e2e/serve.sh: the real Next app on
// the in-memory fixture, the stand-in where the AI model would be, the
// browser's Storage upload intercepted), so nothing here reaches Supabase
// or Anthropic and the files are made-up bytes. Run:
//
//   bash scripts/e2e/serve.sh &            # waits for the build, then serves on :3120
//   PW_CHROMIUM=/opt/pw-browsers/chromium node qa/walk_docai_piece1.mjs
//
// Writes qa/previews/docai-piece1/<light|dark>/NN-name.png and a short
// walk.json saying what each shot is and whether the expected text was on
// the screen when it was taken.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { GOOD_NAMES, makeFile } from "../src/testing/vaultFiles.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3120";
const OUT = path.join(HERE, "previews", "docai-piece1");
const ORG = "/org/bridge-fixture";
const WIDTH = 390;
const HEIGHT = 844;

const FORMAT_LABEL = { pdf: "PDF", docx: "Word", doc: "Word", xlsx: "Excel", xls: "Excel", csv: "CSV", jpg: "JPG", png: "PNG", txt: "TXT" };
const record = [];

async function launch() {
  return chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-sandbox"] });
}

async function walk(browser, theme) {
  const dir = path.join(OUT, theme);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
  const page = await context.newPage();
  // The browser's upload to Storage is the one call stood in for.
  await page.route("**/storage/v1/object/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "documents/stub", Id: "stub" }) }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  let n = 0;
  const tag = `${theme}-${Date.now().toString(36)}`;
  async function shot(name, expects = []) {
    n += 1;
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const body = await page.evaluate(() => document.body.innerText);
    // Section labels are upper-cased by the page's CSS, so compare without case.
    const missing = expects.filter((t) => !(t instanceof RegExp ? t.test(body) : body.toLowerCase().includes(t.toLowerCase())));
    const file = `${String(n).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: path.join(dir, file), fullPage: true });
    record.push({ theme, file, width, sideways: scrollW > width, missing: missing.map(String) });
    if (missing.length) console.log(`  ${theme} ${file}: missing ${missing.join(", ")}`);
  }

  async function addFile(name, buffer, category) {
    await page.goto(BASE + ORG + "/documents/new");
    if (category) await page.getByRole("button", { name: category, exact: true }).click();
    await page.setInputFiles("input[name=files]", { name, mimeType: "application/octet-stream", buffer });
  }

  // 1. The add screen, with the seven formats named.
  await page.goto(BASE + ORG + "/documents/new");
  await shot("add-screen", ["No Type", "PDF, Word (DOC, DOCX), Excel (XLS, XLSX), CSV, JPG, PNG and TXT"]);

  // 2. One upload per format. Both old and new Office types, so nine files.
  for (const kind of Object.keys(GOOD_NAMES)) {
    const bytes = Buffer.from(makeFile(kind));
    const name = `${tag}-${GOOD_NAMES[kind]}`;
    await addFile(name, bytes, null);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByRole("heading", { name: "Stored File" }).waitFor();
    await shot(`upload-${kind}`, [name, "Needs Review", "Original File", FORMAT_LABEL[kind], "SHA-256", "Download"]);
    if (kind !== "pdf") {
      const href = await page.getByRole("link", { name: "Download" }).getAttribute("href");
      const res = await page.request.get(BASE + href);
      const same = createHash("sha256").update(await res.body()).digest("hex") === createHash("sha256").update(bytes).digest("hex");
      record.push({ theme, file: `download-${kind}`, status: res.status(), sameBytes: same });
    }
  }

  // 3. A file refused in the browser: a PNG that says it is a JPG.
  await addFile(`${tag}-renamed.jpg`, Buffer.from(makeFile("png")), null);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByText(/contents are a PNG image/).waitFor();
  await shot("refused-mismatch", ["Could Not Store That", "PDF, Word (DOC, DOCX), Excel (XLS, XLSX), CSV, JPG, PNG and TXT"]);

  // 4. A transcript that is not a transcript: kept, in Needs Review, with the reason.
  const offName = `offtype-${tag}-scores.pdf`;
  await addFile(offName, Buffer.from(makeFile("pdf", 90 + n)), "Transcript");
  await page.getByRole("button", { name: "Upload and Read" }).click();
  await page.getByRole("heading", { name: "Kept for Review" }).waitFor();
  await shot("mismatch-needs-review", ["Did not look like Transcript", "Needs Review", "Original File"]);

  // 5. Mark Ready, Archive, Unarchive.
  await page.getByRole("button", { name: "Mark Ready" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).waitFor();
  await shot("marked-ready", ["Ready"]);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Unarchive" }).waitFor();
  await shot("archived", ["Archived", "Unarchive"]);
  await page.goto(BASE + ORG + "/documents");
  await shot("list-archived-hidden", ["Show Archived"]);
  await page.getByRole("link", { name: /Show Archived/ }).click();
  await page.getByText("Hide Archived").waitFor();
  await shot("list-archived-shown", ["Archived", "Hide Archived"]);
  await page.getByRole("link", { name: new RegExp(offName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await page.getByRole("button", { name: "Unarchive" }).click();
  await page.getByRole("button", { name: "Mark Ready" }).waitFor();
  await shot("unarchived-back-in-review", ["Needs Review", "Mark Ready"]);

  // 6. An old type through the existing reader (the stand-in): read, matched,
  // held for review, and applied by a person.
  const readable = Buffer.from(`%PDF-1.4\n%${tag}\n1 0 obj << >> endobj\n%%EOF\n`);
  await page.goto(BASE + ORG + "/documents/new");
  await page.getByRole("button", { name: "Transcript", exact: true }).click();
  await page.locator("select").first().selectOption({ label: "A parent sent it" });
  await page.setInputFiles("input[name=files]", { name: "fall-transcript.pdf", mimeType: "application/pdf", buffer: readable });
  await page.getByRole("button", { name: "Upload and Read" }).click();
  await page.getByRole("heading", { name: /Check This Before It Lands|Kept for Review|Not sure who this is/ }).waitFor();
  await shot("old-type-transcript-read", ["Needs Review", "Original File"]);

  // 7. The whole list, every state.
  await page.goto(BASE + ORG + "/documents");
  await shot("list-all-states", ["Needs Review", "Ready", "Processing", "Uploaded"]);

  if (errors.length) record.push({ theme, pageErrors: errors });
  await context.close();
}

const browser = await launch();
for (const theme of ["light", "dark"]) {
  console.log(`walking ${theme}`);
  await walk(browser, theme);
}
await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(record, null, 2) + "\n");
const bad = record.filter((r) => r.missing?.length || r.sideways || r.pageErrors || r.sameBytes === false || (r.status && r.status !== 200));
console.log(`${record.filter((r) => r.file?.endsWith(".png")).length} shots, ${bad.length} problem(s)`);
for (const b of bad) console.log(JSON.stringify(b));
process.exit(bad.length ? 1 : 0);
