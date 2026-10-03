import { expect, test, type Page } from "@playwright/test";
import { confirmWith, noticeIs, org, unique } from "./support/app";

// Fundraising records through a browser: campaigns, donors and pledges,
// each created, edited and removed, with the validation a person actually
// hits and the promises the screens make (a removed campaign's gifts still
// count; a pledge is never money raised). The server actions behind these
// forms are held one by one in src/laws/fundraisingActions.test.ts.

test.describe.configure({ mode: "serial" });

async function createDonor(page: Page, name: string) {
  await page.goto(org("/fundraising/donors/new"));
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add Donor" }).click();
  await expect(page).toHaveURL(/\/fundraising\/donors\/(?!new)[^/?]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test.describe("campaigns", () => {
  test("create, see it listed with its goal, edit it, and remove it", async ({ page }) => {
    const name = unique("E2E Gala");
    await page.goto(org("/fundraising/campaigns"));
    await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
    await page.getByRole("link", { name: "Add" }).click();

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Kind").selectOption("event");
    await page.getByLabel("Goal").fill("15000");
    await page.getByRole("button", { name: "Create Campaign" }).click();

    // It opens on its own page with the goal and nothing raised yet.
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("$0 of $15,000")).toBeVisible();

    // It is on the list and on the Fundraising overview.
    await page.goto(org("/fundraising/campaigns"));
    await expect(page.getByText(name)).toBeVisible();
    await page.goto(org("/fundraising"));
    await expect(page.getByText(name)).toBeVisible();

    // Edit.
    await page.goto(org("/fundraising/campaigns"));
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("link", { name: "Edit Campaign" }).click();
    const renamed = `${name} 2`;
    await page.getByLabel("Name").fill(renamed);
    await page.getByLabel("Goal").fill("20000");
    await page.getByRole("button", { name: "Save Campaign" }).click();
    await noticeIs(page, "Campaign saved.");
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByText("$0 of $20,000")).toBeVisible();

    // Remove, behind a confirm that says the money stays.
    await page.getByRole("link", { name: "Edit Campaign" }).click();
    await page.getByRole("button", { name: "Remove Campaign" }).click();
    await expect(page.getByRole("dialog")).toContainText("Gifts and pledges that named it stay, and still count");
    await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
    await noticeIs(page, "Campaign removed. Its gifts still count.");
    await page.goto(org("/fundraising/campaigns"));
    await expect(page.getByText(renamed)).toHaveCount(0);
  });

  test("a campaign needs a name, and cannot end before it starts", async ({ page }) => {
    await page.goto(org("/fundraising/campaigns/new"));
    // An empty field is stopped by the browser before the server sees it;
    // spaces get through, and the server says what is missing.
    await page.getByLabel("Name").fill("   ");
    await page.getByRole("button", { name: "Create Campaign" }).click();
    await expect(page.getByText("A campaign needs a name.")).toBeVisible();

    await page.getByLabel("Name").fill(unique("E2E Bad Dates"));
    await page.getByLabel("Starts").fill("2026-05-01");
    await page.getByLabel("Ends").fill("2026-04-01");
    await page.getByRole("button", { name: "Create Campaign" }).click();
    await expect(page.getByText("The end date is before the start.")).toBeVisible();
    await expect(page).toHaveURL(/campaigns\/new$/);
  });

  test("the existing campaign's gifts are counted and shown against its goal", async ({ page }) => {
    await page.goto(org("/fundraising/campaigns"));
    await expect(page.getByText("Fixture Campaign")).toBeVisible();
    await expect(page.getByText("$5,000 raised of a $25,000 goal")).toBeVisible();
  });
});

test.describe("donors", () => {
  test("add, edit and remove a donor", async ({ page }) => {
    const name = unique("E2E Donor");
    await createDonor(page, name);

    await page.getByRole("link", { name: "Edit Donor" }).click();
    const renamed = `${name} Jr`;
    await page.getByLabel("Name").fill(renamed);
    await page.getByLabel("Email").fill("donor@example.test");
    await page.getByRole("button", { name: "Save Donor" }).click();
    await noticeIs(page, "Donor saved.");
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();

    await page.getByRole("link", { name: "Edit Donor" }).click();
    await confirmWith(page, "Remove Donor", "Remove");
    await noticeIs(page, /Donor removed\. Their gifts still count in the totals\./);
    await expect(page.getByText(renamed)).toHaveCount(0);
  });

  test("a donor needs a name", async ({ page }) => {
    await page.goto(org("/fundraising/donors/new"));
    await page.getByLabel("Name").fill("   ");
    await page.getByRole("button", { name: "Add Donor" }).click();
    await expect(page.getByText("A donor needs a name.")).toBeVisible();
  });
});

test.describe("pledges", () => {
  test("record a pledge, see it as owed (not raised), change it, and remove it", async ({ page }) => {
    const donor = unique("E2E Pledger");
    await createDonor(page, donor);

    await page.goto(org("/fundraising/pledges/new"));
    await page.getByLabel("Who Promised It").selectOption({ label: donor });
    await page.getByLabel("Amount").fill("750");
    await page.getByRole("button", { name: "Record the Pledge" }).click();

    // Listed as promised and outstanding, never as money in.
    await expect(page).toHaveURL(/\/fundraising\/pledges$/);
    const row = page.getByRole("link", { name: new RegExp(donor) });
    await expect(row).toContainText("$750.00 promised");
    await page.goto(org("/fundraising"));
    await expect(page.getByText(/Promised, Not Received/)).toBeVisible();
    await expect(page.getByText("$5,750").first()).toBeVisible(); // raised is unchanged by a promise

    // Change the amount.
    await page.goto(org("/fundraising/pledges"));
    await page.getByRole("link", { name: new RegExp(donor) }).click();
    await page.getByLabel("Amount").fill("900");
    await page.getByRole("button", { name: "Save Pledge" }).click();
    await noticeIs(page, "Pledge saved.");
    await expect(page.getByRole("link", { name: new RegExp(donor) })).toContainText("$900.00 promised");

    // Remove.
    await page.getByRole("link", { name: new RegExp(donor) }).click();
    await confirmWith(page, "Remove Pledge", "Remove");
    await noticeIs(page, "Pledge removed.");
    await expect(page.getByText(donor)).toHaveCount(0);
  });

  test("a pledge needs a positive amount and a due date that makes sense", async ({ page }) => {
    // A missing donor is stopped by the browser's own required field; the
    // server's refusal of one is held in src/laws/fundraisingActions.test.ts.
    await page.goto(org("/fundraising/pledges/new"));
    await page.getByLabel("Who Promised It").selectOption({ label: "Fixture Donor" });
    await page.getByLabel("Amount").fill("0");
    await page.getByRole("button", { name: "Record the Pledge" }).click();
    await expect(page.getByText("A pledge has to be a positive amount.")).toBeVisible();

    // The form is reset after a refused submit, so fill it in again.
    await page.getByLabel("Who Promised It").selectOption({ label: "Fixture Donor" });
    await page.getByLabel("Amount").fill("100");
    await page.getByLabel("Promised", { exact: true }).fill("2026-09-01");
    await page.getByLabel("Due", { exact: true }).fill("2026-08-01");
    await page.getByRole("button", { name: "Record the Pledge" }).click();
    await expect(page.getByText("The due date is before the promise was made.")).toBeVisible();
    await expect(page).toHaveURL(/pledges\/new$/);
  });
});

test.describe("who can see it", () => {
  test("a Viewer and an Athlete login do not get the fundraising screens", async ({ page, context, baseURL }) => {
    for (const who of ["00000000-0000-0000-0000-0000000000b2", "00000000-0000-0000-0000-0000000000b5"]) {
      await context.clearCookies();
      await context.addCookies([{ name: "fixture_user", value: who, url: baseURL! }]);
      for (const path of ["/fundraising", "/fundraising/campaigns", "/fundraising/donors/new", "/fundraising/pledges/new"]) {
        await page.goto(org(path));
        await expect(page.getByRole("button", { name: /Create Campaign|Add Donor|Record the Pledge/ })).toHaveCount(0);
      }
    }
  });
});
