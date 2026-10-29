import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { db, pool } from "../database.js";
import { adsRoutes } from "../ads-routes.js";
import { validateCampaign, campaignOperations } from "../google-ads.js";
if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production")
  throw Error("Run against an isolated Neon branch.");
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer";
const originalFetch = globalThis.fetch;
let refreshes = 0,
  mutations = 0,
  validations = 0,
  mode = "normal",
  lastOperations,
  resourceCounter = 100000;
const publications = new Map();
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (!u.hostname.endsWith("googleapis.com"))
    return originalFetch(url, options);
  if (u.hostname === "oauth2.googleapis.com") {
    const params = new URLSearchParams(options.body);
    if (params.get("grant_type") === "refresh_token") refreshes++;
    else assert.ok(params.get("code_verifier"));
    return json({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 3600,
      scope: "openid email https://www.googleapis.com/auth/adwords",
    });
  }
  if (u.pathname === "/oauth2/v3/userinfo")
    return json({
      sub: "google-test-user",
      email: "google@example.test",
      email_verified: true,
    });
  if (u.pathname.endsWith(":listAccessibleCustomers"))
    return json({ resourceNames: ["customers/1234567890"] });
  const body = JSON.parse(options.body || "{}");
  if (u.pathname.endsWith("googleAds:search")) {
    if (body.query.includes("campaign.name LIKE")) {
      const id = body.query.match(/%([a-f0-9-]{36})%/)[1];
      return json({
        results: publications.has(id)
          ? [{ campaign: { resourceName: publications.get(id) } }]
          : [],
      });
    }
    if (body.query.includes("FROM customer LIMIT"))
      return json({
        results: [
          {
            customer: {
              id: "1234567890",
              descriptiveName: "Test Ads",
              currencyCode: "INR",
              manager: false,
            },
          },
        ],
      });
    if (body.query.includes("metrics."))
      return json({
        results: [
          {
            metrics: {
              impressions: "123",
              clicks: "7",
              costMicros: "25000000",
            },
          },
        ],
      });
    return json({
      results: [
        {
          campaign: {
            id: "987",
            resourceName: "customers/1234567890/campaigns/987",
            name: "Google campaign",
            advertisingChannelType: "SEARCH",
            status: "PAUSED",
          },
          campaignBudget: { amountMicros: "50000000" },
        },
      ],
    });
  }
  if (u.pathname.endsWith("googleAds:mutate")) {
    assert.equal(body.partialFailure, false);
    lastOperations = body.mutateOperations;
    if (body.validateOnly) {
      validations++;
      if (mode === "reject")
        return new Response(
          JSON.stringify({ error: { message: "Ad text rejected" } }),
          { status: 400 },
        );
      return json({});
    }
    mutations++;
    const name = body.mutateOperations[1].campaignOperation.create.name;
    const id = name.match(/\[8LM ([a-f0-9-]+)\]/)[1];
    const resource = "customers/1234567890/campaigns/" + ++resourceCounter;
    publications.set(id, resource);
    if (mode === "timeout") throw Error("simulated lost response");
    return json({
      mutateOperationResponses: [
        { campaignResult: { resourceName: resource } },
      ],
    });
  }
  if (u.pathname.endsWith("campaigns:mutate")) {
    assert.equal(body.operations[0].updateMask, "status");
    return json({
      results: [{ resourceName: body.operations[0].update.resourceName }],
    });
  }
  throw Error("Unexpected Google request " + url);
};
const users = [],
  workspaces = [];
let server;
try {
  for (let i = 0; i < 2; i++) {
    const u = await db.get(
      "INSERT INTO eightlm.users(email,salt,password_hash) VALUES($1,$2,$3) RETURNING id,email",
      `google-test-${randomUUID()}@example.test`,
      "test",
      "test",
    );
    users.push(u);
  }
  for (let i = 0; i < 2; i++) {
    const w = await db.get(
      "INSERT INTO eightlm.workspaces(name) VALUES($1) RETURNING id",
      "Publishing test",
    );
    workspaces.push(w.id);
    await db.run(
      "INSERT INTO eightlm.members VALUES($1,$2,$3)",
      w.id,
      users[i].id,
      "Owner",
    );
  }
  await db.run(
    "INSERT INTO eightlm.members VALUES($1,$2,$3)",
    workspaces[0],
    users[1].id,
    "Viewer",
  );
  const app = express();
  app.use(express.json());
  adsRoutes(app, db, async (req) =>
    req.headers.cookie?.includes("owner-session")
      ? users[0]
      : req.headers.cookie?.includes("viewer-session")
        ? users[1]
        : null,
  );
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_ORIGIN = base;
  const prefix = "/api/workspaces/" + workspaces[0];
  async function call(path, method = "GET", body, who = "owner-session") {
    const r = await originalFetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        Cookie: "8lm_session=" + who,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      location: r.headers.get("location"),
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : null,
    };
  }
  assert.equal(
    (await call(prefix + "/auth/google/url", "GET", null, "viewer-session"))
      .status,
    403,
  );
  const start = await call(prefix + "/auth/google/url");
  const oauth = new URL(start.data.url);
  const state = oauth.searchParams.get("state");
  assert.equal(state.length, 64);
  assert.ok(oauth.searchParams.get("code_challenge"));
  assert.notEqual(state, String(workspaces[0]));
  assert.match(
    (
      await call(
        "/api/auth/google/callback?state=" + state + "&code=code",
        "GET",
        null,
        "viewer-session",
      )
    ).location,
    /oauth_error/,
  );
  assert.match(
    (await call("/api/auth/google/callback?state=" + state + "&code=code"))
      .location,
    /oauth=success/,
  );
  assert.match(
    (await call("/api/auth/google/callback?state=" + state + "&code=code"))
      .location,
    /oauth_error/,
  );
  assert.match(
    (
      await call(
        "/api/auth/google/callback?state=" + workspaces[1] + "&code=code",
      )
    ).location,
    /oauth_error/,
  );
  console.log(
    "PASS OAuth: opaque session-bound state, PKCE, wrong-user rejection, replay rejection, raw workspace state rejected.",
  );
  const expired = await call(prefix + "/auth/google/url");
  const expiredState = new URL(expired.data.url).searchParams.get("state");
  await db.run(
    "UPDATE eightlm.google_oauth_states SET expires_at=0 WHERE workspace_id=$1",
    workspaces[0],
  );
  assert.match(
    (
      await call(
        "/api/auth/google/callback?state=" + expiredState + "&code=code",
      )
    ).location,
    /oauth_error/,
  );
  const revoked = await call(prefix + "/auth/google/url");
  await db.run(
    "UPDATE eightlm.members SET role='Viewer' WHERE workspace_id=$1 AND user_id=$2",
    workspaces[0],
    users[0].id,
  );
  assert.match(
    (
      await call(
        "/api/auth/google/callback?state=" +
          new URL(revoked.data.url).searchParams.get("state") +
          "&code=code",
      )
    ).location,
    /oauth_error/,
  );
  await db.run(
    "UPDATE eightlm.members SET role='Owner' WHERE workspace_id=$1 AND user_id=$2",
    workspaces[0],
    users[0].id,
  );
  assert.equal(
    (await call(prefix + "/auth/google/connect-demo", "POST", {})).status,
    400,
  );
  await db.run(
    "UPDATE eightlm.oauth_tokens SET expires_at=0 WHERE workspace_id=$1",
    workspaces[0],
  );
  assert.equal(
    (await call(prefix + "/ads/accounts")).data.accounts[0].currency,
    "INR",
  );
  await call(prefix + "/ads/accounts");
  assert.equal(refreshes, 1);
  assert.equal(
    (
      await call(prefix + "/ads/customer-id", "POST", {
        customer_id: "1234567890",
      })
    ).status,
    200,
  );
  console.log(
    "PASS OAuth: expiry, permission revocation, disabled demo, automatic refresh and verified account selection.",
  );
  const payload = {
    name: "Test search",
    channel: "Search",
    ad_group: "Primary",
    budget: 100,
    cpc: 5,
    country: "India",
    match_type: "PHRASE",
    final_url: "https://example.com/",
    keywords: "test services\nquality services",
    headlines: "Find Quality Services\nExplore Our Services\nContact Our Team",
    descriptions:
      "Find the service you need. Visit our website to learn more.\nSpeak with our team about the options available to you.",
    eu_political: false,
  };
  assert.throws(() =>
    validateCampaign({ ...payload, eu_political: undefined }),
  );
  assert.throws(() => validateCampaign({ ...payload, budget: -1 }));
  assert.throws(() => validateCampaign({ ...payload, headlines: "Only one" }));
  assert.throws(() =>
    validateCampaign({ ...payload, final_url: "javascript:alert(1)" }),
  );
  const operations = campaignOperations(
    "1234567890",
    validateCampaign(payload),
    randomUUID(),
  );
  assert.equal(operations[1].campaignOperation.create.status, "PAUSED");
  assert.equal(
    operations.at(-1).adGroupAdOperation.create.ad.responsiveSearchAd.headlines
      .length,
    3,
  );
  assert.equal(operations.filter((o) => o.adGroupCriterionOperation).length, 2);
  const draft = await call(prefix + "/campaigns/create", "POST", payload);
  assert.equal(draft.status, 200);
  const draftId = draft.data.draft.id;
  assert.equal(
    (
      await call(
        prefix + "/campaigns/" + draftId + "/publish",
        "POST",
        {},
        "viewer-session",
      )
    ).status,
    403,
  );
  const results = await Promise.all([
    call(prefix + "/campaigns/" + draftId + "/publish", "POST", {}),
    call(prefix + "/campaigns/" + draftId + "/publish", "POST", {}),
  ]);
  assert.ok(results.every((r) => r.data.ok));
  assert.equal(mutations, 1);
  assert.equal(validations, 1);
  assert.ok(lastOperations.some((x) => x.campaignCriterionOperation));
  console.log(
    "PASS publishing: full atomic Search payload, validation, role enforcement, concurrent retries create exactly once.",
  );
  const second = await call(prefix + "/campaigns/create", "POST", {
    ...payload,
    name: "Interrupted",
  });
  mode = "timeout";
  const pending = await call(
    prefix + "/campaigns/" + second.data.draft.id + "/publish",
    "POST",
    {},
  );
  assert.equal(pending.status, 202);
  assert.equal(pending.data.pending, true);
  assert.equal(mutations, 2);
  mode = "normal";
  const reconciled = await call(
    prefix + "/campaigns/" + second.data.draft.id + "/publish",
    "POST",
    {},
  );
  assert.equal(reconciled.data.ok, true);
  assert.equal(mutations, 2);
  const rejected = await call(prefix + "/campaigns/create", "POST", {
    ...payload,
    name: "Rejected",
  });
  mode = "reject";
  assert.equal(
    (
      await call(
        prefix + "/campaigns/" + rejected.data.draft.id + "/publish",
        "POST",
        {},
      )
    ).status,
    400,
  );
  assert.equal(mutations, 2);
  mode = "normal";
  const campaigns = await call(prefix + "/ads/campaigns");
  assert.equal(campaigns.data.metrics.clicks, 7);
  assert.equal(campaigns.data.currency_code, "INR");
  assert.equal(
    (
      await call(prefix + "/campaigns/1234567890:987/status", "PATCH", {
        status: "ENABLED",
      })
    ).status,
    200,
  );
  console.log(
    "PASS publishing: lost-response reconciliation without duplicate creation, validation rejection, real-response metrics/currency, Google status mutation.",
  );
  assert.equal((await call(prefix + "/ads", "DELETE")).status, 200);
  assert.equal(
    await db.get(
      "SELECT 1 FROM eightlm.oauth_tokens WHERE workspace_id=$1",
      workspaces[0],
    ),
    undefined,
  );
  assert.equal(
    (
      await call(
        prefix + "/campaigns/" + rejected.data.draft.id + "/publish",
        "POST",
        {},
      )
    ).status,
    400,
  );
  console.log(
    "PASS disconnect: stored tokens removed and subsequent publishing blocked.",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (server) await new Promise((r) => server.close(r));
  for (const id of workspaces)
    await db.run("DELETE FROM eightlm.workspaces WHERE id=$1", id);
  for (const user of users)
    await db.run("DELETE FROM eightlm.users WHERE id=$1", user.id);
  await pool.end();
}
