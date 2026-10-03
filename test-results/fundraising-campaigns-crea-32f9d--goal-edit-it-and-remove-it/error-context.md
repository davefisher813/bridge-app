# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fundraising.spec.ts >> campaigns >> create, see it listed with its goal, edit it, and remove it
- Location: e2e/fundraising.spec.ts:21:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Campaigns' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'Campaigns' }) with timeout 10000ms
  - waiting for getByRole('heading', { name: 'Campaigns' })

```

```yaml
- main:
  - heading "Nothing Here" [level=2]
  - paragraph: That link points at something that was removed, or that this account cannot see.
  - link "Back to the Start":
    - /url: /
- alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { confirmWith, noticeIs, org, unique } from "./support/app";
  3   | 
  4   | // Fundraising records through a browser: campaigns, donors and pledges,
  5   | // each created, edited and removed, with the validation a person actually
  6   | // hits and the promises the screens make (a removed campaign's gifts still
  7   | // count; a pledge is never money raised). The server actions behind these
  8   | // forms are held one by one in src/laws/fundraisingActions.test.ts.
  9   | 
  10  | test.describe.configure({ mode: "serial" });
  11  | 
  12  | async function createDonor(page: Page, name: string) {
  13  |   await page.goto(org("/fundraising/donors/new"));
  14  |   await page.getByLabel("Name").fill(name);
  15  |   await page.getByRole("button", { name: "Add Donor" }).click();
  16  |   await expect(page).toHaveURL(/\/fundraising\/donors\/(?!new)[^/?]+$/);
  17  |   await expect(page.getByRole("heading", { name })).toBeVisible();
  18  | }
  19  | 
  20  | test.describe("campaigns", () => {
  21  |   test("create, see it listed with its goal, edit it, and remove it", async ({ page }) => {
  22  |     const name = unique("E2E Gala");
  23  |     await page.goto(org("/fundraising/campaigns"));
> 24  |     await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  25  |     await page.getByRole("link", { name: "Add" }).click();
  26  | 
  27  |     await page.getByLabel("Name").fill(name);
  28  |     await page.getByLabel("Kind").selectOption("event");
  29  |     await page.getByLabel("Goal").fill("15000");
  30  |     await page.getByRole("button", { name: "Create Campaign" }).click();
  31  | 
  32  |     // It opens on its own page with the goal and nothing raised yet.
  33  |     await expect(page.getByRole("heading", { name })).toBeVisible();
  34  |     await expect(page.getByText("$0 of $15,000")).toBeVisible();
  35  | 
  36  |     // It is on the list and on the Fundraising overview.
  37  |     await page.goto(org("/fundraising/campaigns"));
  38  |     await expect(page.getByText(name)).toBeVisible();
  39  |     await page.goto(org("/fundraising"));
  40  |     await expect(page.getByText(name)).toBeVisible();
  41  | 
  42  |     // Edit.
  43  |     await page.goto(org("/fundraising/campaigns"));
  44  |     await page.getByRole("link", { name: new RegExp(name) }).click();
  45  |     await page.getByRole("link", { name: "Edit Campaign" }).click();
  46  |     const renamed = `${name} 2`;
  47  |     await page.getByLabel("Name").fill(renamed);
  48  |     await page.getByLabel("Goal").fill("20000");
  49  |     await page.getByRole("button", { name: "Save Campaign" }).click();
  50  |     await noticeIs(page, "Campaign saved.");
  51  |     await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  52  |     await expect(page.getByText("$0 of $20,000")).toBeVisible();
  53  | 
  54  |     // Remove, behind a confirm that says the money stays.
  55  |     await page.getByRole("link", { name: "Edit Campaign" }).click();
  56  |     await page.getByRole("button", { name: "Remove Campaign" }).click();
  57  |     await expect(page.getByRole("dialog")).toContainText("Gifts and pledges that named it stay, and still count");
  58  |     await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  59  |     await noticeIs(page, "Campaign removed. Its gifts still count.");
  60  |     await page.goto(org("/fundraising/campaigns"));
  61  |     await expect(page.getByText(renamed)).toHaveCount(0);
  62  |   });
  63  | 
  64  |   test("a campaign needs a name, and cannot end before it starts", async ({ page }) => {
  65  |     await page.goto(org("/fundraising/campaigns/new"));
  66  |     await page.getByRole("button", { name: "Create Campaign" }).click();
  67  |     await expect(page.getByText("A campaign needs a name.")).toBeVisible();
  68  | 
  69  |     await page.getByLabel("Name").fill(unique("E2E Bad Dates"));
  70  |     await page.getByLabel("Starts").fill("2026-05-01");
  71  |     await page.getByLabel("Ends").fill("2026-04-01");
  72  |     await page.getByRole("button", { name: "Create Campaign" }).click();
  73  |     await expect(page.getByText("The end date is before the start.")).toBeVisible();
  74  |     await expect(page).toHaveURL(/campaigns\/new$/);
  75  |   });
  76  | 
  77  |   test("the existing campaign's gifts are counted and shown against its goal", async ({ page }) => {
  78  |     await page.goto(org("/fundraising/campaigns"));
  79  |     await expect(page.getByText("Fixture Campaign")).toBeVisible();
  80  |     await expect(page.getByText("$5,000 raised of a $25,000 goal")).toBeVisible();
  81  |   });
  82  | });
  83  | 
  84  | test.describe("donors", () => {
  85  |   test("add, edit and remove a donor", async ({ page }) => {
  86  |     const name = unique("E2E Donor");
  87  |     await createDonor(page, name);
  88  | 
  89  |     await page.getByRole("link", { name: "Edit Donor" }).click();
  90  |     const renamed = `${name} Jr`;
  91  |     await page.getByLabel("Name").fill(renamed);
  92  |     await page.getByLabel("Email").fill("donor@example.test");
  93  |     await page.getByRole("button", { name: "Save Donor" }).click();
  94  |     await noticeIs(page, "Donor saved.");
  95  |     await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  96  | 
  97  |     await page.getByRole("link", { name: "Edit Donor" }).click();
  98  |     await confirmWith(page, "Remove Donor", "Remove");
  99  |     await noticeIs(page, /Donor removed\. Their gifts still count in the totals\./);
  100 |     await expect(page.getByText(renamed)).toHaveCount(0);
  101 |   });
  102 | 
  103 |   test("a donor needs a name", async ({ page }) => {
  104 |     await page.goto(org("/fundraising/donors/new"));
  105 |     await page.getByRole("button", { name: "Add Donor" }).click();
  106 |     await expect(page.getByText("A donor needs a name.")).toBeVisible();
  107 |   });
  108 | });
  109 | 
  110 | test.describe("pledges", () => {
  111 |   test("record a pledge, see it as owed (not raised), change it, and remove it", async ({ page }) => {
  112 |     const donor = unique("E2E Pledger");
  113 |     await createDonor(page, donor);
  114 | 
  115 |     await page.goto(org("/fundraising/pledges/new"));
  116 |     await page.getByLabel("Who Promised It").selectOption({ label: donor });
  117 |     await page.getByLabel("Amount").fill("750");
  118 |     await page.getByRole("button", { name: "Record the Pledge" }).click();
  119 | 
  120 |     // Listed as promised and outstanding, never as money in.
  121 |     await expect(page).toHaveURL(/\/fundraising\/pledges$/);
  122 |     const row = page.getByRole("link", { name: new RegExp(donor) });
  123 |     await expect(row).toContainText("$750.00 promised");
  124 |     await page.goto(org("/fundraising"));
```