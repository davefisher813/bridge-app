import { expect, test } from "@playwright/test";
import { ATHLETE, confirmWith, noticeIs, org } from "./support/app";

// Matching: the schools scored for an athlete, what feeds the score (a
// logged metric), what rescoring does (a preset change, Recalculate All),
// and putting a match on the board. The scoring itself is the pure engine
// in src/lib/fit, held by src/laws/fitLaws.test.ts and matchingLaws.test.ts;
// these tests are about the screens and the wiring around it.

test.describe.configure({ mode: "serial" });

test.describe("recruiting matches", () => {
  test("the athlete's matches are listed, scored, and searchable", async ({ page }) => {
    await page.goto(org(`/roster/${ATHLETE}/matches`));
    await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible();
    await expect(page.getByText("2 schools scored for Fixture Athlete")).toBeVisible();
    await expect(page.getByText("Fixture College")).toBeVisible();
    await expect(page.getByText("Fixture State University")).toBeVisible();
    // Each row carries its division and a score.
    await expect(page.getByText(/D3 · \d+ ·/)).toBeVisible();
    await expect(page.getByText(/D2 · \d+ ·/)).toBeVisible();

    // The filters narrow the list.
    await page.getByLabel("Search").first().fill("State University");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Fixture State University")).toBeVisible();
    await expect(page.getByText("Fixture College", { exact: true })).toHaveCount(0);
  });

  test("a logged metric is recorded, scored, and shown as the athlete's current number", async ({ page }) => {
    await page.goto(org(`/roster/${ATHLETE}/metrics`));
    await page.locator("[name=metric]").selectOption({ label: "FB Velo" });
    await page.locator("[name=value]").fill("97");
    await page.locator("[name=source]").selectOption({ label: "Premier" });
    await page.getByRole("button", { name: "Log Metric" }).click();

    await expect(page.getByText("5 entries logged")).toBeVisible();
    await expect(page.getByText("97 mph").first()).toBeVisible();
    await expect(page.getByText(/Scores · Premier/).first()).toBeVisible();
  });

  test("an impossible metric is refused with a sentence, and nothing is logged", async ({ page }) => {
    await page.goto(org(`/roster/${ATHLETE}/metrics`));
    const before = await page.getByText(/\d+ entries logged/).textContent();
    await page.locator("[name=metric]").selectOption({ label: "FB Velo" });
    await page.locator("[name=value]").fill("99999");
    await page.getByRole("button", { name: "Log Metric" }).click();
    await expect(page.getByText("That number is too large")).toBeVisible();
    await expect(page.getByText(/\d+ entries logged/)).toHaveText(before!);
  });

  test("Recalculate All Matches asks first, then says how many it rescored", async ({ page }) => {
    await page.goto(org("/more"));
    await page.getByRole("button", { name: "Recalculate All Matches" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Recalculate Every Match?")).toBeVisible();

    // Backing out changes nothing.
    await dialog.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/notice=/);

    await confirmWith(page, "Recalculate All Matches", "Recalculate");
    await expect(page).toHaveURL(/notice=/);
    await noticeIs(page, /\d+ matches? recalculated\./);

    // The matches are still there, still ranked.
    await page.goto(org(`/roster/${ATHLETE}/matches`));
    await expect(page.getByText("2 schools scored for Fixture Athlete")).toBeVisible();
  });

  test("changing the scoring preset is saved and survives a reload", async ({ page }) => {
    await page.goto(org("/more"));
    await page.getByLabel("Scoring Preset").selectOption("baseball_first");
    await page.getByRole("button", { name: "Save Preset" }).click();
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Scoring Preset")).toHaveValue("baseball_first");

    // Put it back so the next run starts where this one did.
    await page.getByLabel("Scoring Preset").selectOption("money_first");
    await page.getByRole("button", { name: "Save Preset" }).click();
    await page.reload();
    await expect(page.getByLabel("Scoring Preset")).toHaveValue("money_first");
  });

  test("Add Target puts a match on the board at the Target stage", async ({ page }) => {
    await page.goto(org(`/roster/${ATHLETE}/matches`));
    await page.getByRole("button", { name: "Add Target" }).first().click();
    await expect(page).toHaveURL(new RegExp(`${org("/board/")}`));
    await expect(page.getByText("Fixture College").first()).toBeVisible();
    await expect(page.getByText("Fixture Athlete").first()).toBeVisible();

    // The match no longer offers Add Target for that school.
    await page.goto(org(`/roster/${ATHLETE}/matches`));
    await expect(page.getByRole("button", { name: "Add Target" })).toHaveCount(0);
  });

  test("only an owner can recalculate: a Viewer does not get the screen", async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await context.addCookies([{ name: "fixture_user", value: "00000000-0000-0000-0000-0000000000b2", url: baseURL! }]);
    await page.goto(org("/more"));
    await expect(page.getByRole("button", { name: "Recalculate All Matches" })).toHaveCount(0);
  });
});
