const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  let drafts = [],
    published = false,
    selected = true;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname,
      method = req.method();
    let result;
    if (p === "/api/me") result = { user: { email: "owner@example.com" } };
    else if (p === "/api/workspaces")
      result = {
        workspaces: [{ id: 1, name: "Studio workspace", role: "Owner" }],
      };
    else if (p === "/api/workspaces/1")
      result = {
        workspace: { id: 1, name: "Studio workspace", role: "Owner" },
        members: [{ id: 1, email: "owner@example.com", role: "Owner" }],
        invites: [],
        activity: [],
      };
    else if (p.endsWith("/ads/accounts"))
      result = {
        accounts: [
          {
            id: "1234567890",
            name: "Studio Ads",
            currency: "INR",
            managerId: null,
          },
        ],
        notices: [],
      };
    else if (p.endsWith("/ads/customer-id")) result = { ok: true };
    else if (p.endsWith("/ads"))
      result = {
        ads: selected
          ? {
              customer_id: "1234567890",
              account_name: "Studio Ads",
              currency_code: "INR",
              status: "ACTIVE",
            }
          : null,
        oauth: { account_email: "google@example.com" },
        oauth_ready: true,
        api_configured: true,
      };
    else if (p.endsWith("/campaigns/drafts")) result = { drafts };
    else if (p.endsWith("/ads/campaigns"))
      result = {
        campaigns: published
          ? [
              {
                id: "1234567890:99",
                name: "Brand Search",
                channel: "SEARCH",
                status: "PAUSED",
                budget: "INR 100.00/day",
                imported: true,
                google_resource: "customers/1234567890/campaigns/99",
              },
            ]
          : [],
        customer_id: "1234567890",
        currency_code: "INR",
        hasDeveloperToken: true,
        metrics: { impressions: 123, clicks: 7 },
        apiNotice: null,
      };
    else if (p.endsWith("/campaigns/create")) {
      const payload = req.postDataJSON();
      drafts = [
        { id: "draft-1", customer_id: "1234567890", payload, state: "DRAFT" },
      ];
      result = { ok: true, draft: { id: "draft-1" } };
    } else if (p.endsWith("/publish")) {
      published = true;
      drafts[0].state = "PUBLISHED";
      drafts[0].resource_name = "customers/1234567890/campaigns/99";
      result = {
        ok: true,
        resource: drafts[0].resource_name,
        status: "PAUSED",
      };
    } else throw Error("Unexpected " + method + " " + p);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("http://localhost:8018");
  await page.locator("#your-role").filter({ hasText: "Owner" }).waitFor();
  await page.locator("#nav-ads").click();
  await page.getByText("google@example.com", { exact: true }).waitFor();
  assert.equal(await page.locator("#google-account-select option").count(), 1);
  await page.screenshot({
    path: path.resolve("../outputs/google-connection.png"),
  });
  await page.locator("#nav-campaigns").click();
  await page.locator("#create-campaign-open-btn").click();
  await page.locator("#wizard-pane-1").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.resolve("../outputs/restored-campaign-objective.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Objective mobile overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#wizard-step-1-next").click();
  assert.equal(
    await page
      .locator('[data-type="Performance Max"]')
      .getAttribute("aria-disabled"),
    "true",
  );
  await page.locator("#wizard-step-2-next").click();
  await page.locator("#wizard-campaign-name").fill("Brand Search");
  await page.locator("#wizard-step-3-next").click();
  assert.equal(
    await page.locator("#wizard-bidding-focus").inputValue(),
    "Manual CPC",
  );
  await page.locator("#wizard-step-4-next").click();
  await page.locator("#wizard-step-5-next").click();
  await page.locator("#rsa-final-url").fill("https://example.com");
  await page.locator("#wizard-keywords-input").fill("brand services");
  for (const [i, text] of [
    "Explore Our Services",
    "Find Your Solution",
    "Contact Our Team",
  ].entries())
    await page.locator(".rsa-hl-input").nth(i).fill(text);
  for (const [i, text] of [
    "Find the service you need on our website.",
    "Speak to our team to learn about your options.",
  ].entries())
    await page.locator(".rsa-desc-input").nth(i).fill(text);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: path.resolve("../outputs/restored-campaign-ads.png"),
    fullPage: true,
  });
  await page.locator("#wizard-step-6-next").click();
  await page.locator("#wizard-step-7-next").click();
  await page.locator("#wizard-budget-input").fill("100");
  await page.locator("#wizard-step-8-next").click();
  await page.locator("#wizard-adgroup").fill("Brand");
  await page.locator("#wizard-max-cpc").fill("5");
  await page.locator("#wizard-eu").check();
  await page.locator("#wizard-step-9-back").click();
  assert.equal(await page.locator("#wizard-budget-input").inputValue(), "100");
  await page.locator("#wizard-step-8-next").click();
  await page.locator("#wizard-publish-btn").click();
  await page
    .getByRole("button", { name: "Publish paused", exact: true })
    .waitFor();
  assert.equal(published, false);
  await page
    .getByRole("button", { name: "Publish paused", exact: true })
    .click();
  await page.getByText(/Google ID 99/).waitFor();
  assert.equal(published, true);
  assert.equal(await page.locator("#kpi-clicks").textContent(), "7");
  await page.screenshot({
    path: path.resolve("../outputs/published-campaign.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth)
          .map((e) => ({
            id: e.id,
            cls: e.className,
            width: e.getBoundingClientRect().width,
            right: e.getBoundingClientRect().right,
          })),
      ),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser: connection selector, draft-only save, explicit paused publication, confirmed Google ID, real-response metrics, mobile width; no JavaScript errors.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
