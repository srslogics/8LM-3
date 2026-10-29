import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as google from "./google-ads.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sessionHash = (req) =>
  hash(
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("8lm_session="))
      ?.slice(12) || "",
  );
const origin = () =>
  new URL(
    process.env.APP_ORIGIN ||
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${process.env.PORT || 8000}`,
  ).origin;
const managers = ["Owner", "Admin"];
const publishers = ["Owner", "Admin", "Publisher"];
export function adsRoutes(app, db, session) {
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof google.GoogleError)
        return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  async function member(req, roles) {
    const user = await session(req);
    if (!user) throw new google.GoogleError("Please log in.", 401);
    if (!/^[1-9]\d*$/.test(req.params.id))
      throw new google.GoogleError("Workspace not found.", 404);
    const m = await db.get(
      "SELECT role FROM eightlm.members WHERE workspace_id=$1 AND user_id=$2",
      req.params.id,
      user.id,
    );
    if (!m) throw new google.GoogleError("Workspace not found.", 404);
    if (roles && !roles.includes(m.role))
      throw new google.GoogleError(
        "Your workspace role cannot perform this action.",
        403,
      );
    return user;
  }
  const locked = (req, roles, fn) =>
    db.transaction(async () => {
      await db.get(
        "SELECT id FROM eightlm.workspaces WHERE id=$1 FOR UPDATE",
        req.params.id,
      );
      const user = await member(req, roles);
      return fn(user);
    })();
  async function token(id) {
    return db.transaction(async () => {
      const row = await db.get(
        "SELECT * FROM eightlm.oauth_tokens WHERE workspace_id=$1 FOR UPDATE",
        id,
      );
      if (!row || !row.refresh_token || row.access_token.startsWith("demo_"))
        throw new google.GoogleError("Reconnect Google to continue.");
      if (Number(row.expires_at) > Date.now() + 90000) return row.access_token;
      const fresh = await google.refreshGoogleToken(row.refresh_token);
      if (!fresh.access_token)
        throw new google.GoogleError(
          "Reconnect Google: no access token was returned.",
        );
      await db.run(
        "UPDATE eightlm.oauth_tokens SET access_token=$1,refresh_token=$2,expires_at=$3 WHERE workspace_id=$4",
        fresh.access_token,
        fresh.refresh_token || row.refresh_token,
        Date.now() + Number(fresh.expires_in || 3600) * 1000,
        id,
      );
      return fresh.access_token;
    })();
  }
  async function connection(id) {
    const row = await db.get(
      "SELECT * FROM eightlm.google_ads WHERE workspace_id=$1 AND status='ACTIVE'",
      id,
    );
    if (!row || !/^\d{10}$/.test(row.customer_id))
      throw new google.GoogleError(
        "Connect Google and select an advertising account first.",
      );
    return row;
  }
  const audit = (id, user, message) =>
    db.run(
      "INSERT INTO eightlm.activity(workspace_id,actor,action,created) VALUES($1,$2,$3,$4)",
      id,
      user.email,
      message,
      Date.now(),
    );
  app.get(
    "/api/workspaces/:id/auth/google/url",
    wrap(async (req, res) => {
      await member(req, managers);
      if (!google.isGoogleOAuthReady())
        throw new google.GoogleError(
          "Google OAuth is not configured. Ask the administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        );
      const user = await member(req, managers),
        state = randomBytes(32).toString("hex"),
        verifier = randomBytes(32).toString("base64url");
      await db.run(
        "DELETE FROM eightlm.google_oauth_states WHERE expires_at<$1",
        Date.now(),
      );
      await db.run(
        "INSERT INTO eightlm.google_oauth_states VALUES($1,$2,$3,$4,$5,$6)",
        hash(state),
        req.params.id,
        user.id,
        sessionHash(req),
        verifier,
        Date.now() + 600000,
      );
      res.json({
        configured: true,
        url: google.getGoogleOAuthUrl(
          state,
          createHash("sha256").update(verifier).digest("base64url"),
          origin(),
        ),
      });
    }),
  );
  app.get(
    "/api/auth/google/callback",
    wrap(async (req, res) => {
      const user = await session(req),
        state = req.query.state;
      if (!user || typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state))
        return res.redirect(
          "/#oauth_error=Authorization%20expired.%20Reconnect%20Google.",
        );
      // Atomic consumption binds the single-use state to both user and exact browser session.
      const pending = await db.get(
        "DELETE FROM eightlm.google_oauth_states WHERE state_hash=$1 AND user_id=$2 AND session_hash=$3 AND expires_at>$4 RETURNING *",
        hash(state),
        user.id,
        sessionHash(req),
        Date.now(),
      );
      if (!pending)
        return res.redirect(
          "/#oauth_error=Invalid%20or%20expired%20authorization.",
        );
      req.params.id = String(pending.workspace_id);
      try {
        await member(req, managers);
        if (req.query.error || typeof req.query.code !== "string")
          throw new google.GoogleError("Google authorization was declined.");
        const tokens = await google.exchangeOAuthCode(
          req.query.code,
          pending.verifier,
          origin(),
        );
        if (
          !tokens.access_token ||
          !tokens.refresh_token ||
          !String(tokens.scope || "")
            .split(" ")
            .includes("https://www.googleapis.com/auth/adwords")
        )
          throw new google.GoogleError(
            "Grant Google Ads access and offline access, then reconnect.",
          );
        const profile = await google.getGoogleProfile(tokens.access_token);
        await locked(req, managers, async () => {
          await db.run(
            `INSERT INTO eightlm.oauth_tokens(workspace_id,provider,account_email,account_id,account_name,access_token,refresh_token,expires_at,connected_at) VALUES($1,'google',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id) DO UPDATE SET account_email=$2,account_id=$3,account_name=$4,access_token=$5,refresh_token=$6,expires_at=$7,connected_at=$8`,
            pending.workspace_id,
            profile.email,
            profile.sub,
            profile.name || profile.email,
            tokens.access_token,
            tokens.refresh_token,
            Date.now() + Number(tokens.expires_in || 3600) * 1000,
            Date.now(),
          );
          await db.run(
            "DELETE FROM eightlm.google_ads WHERE workspace_id=$1",
            pending.workspace_id,
          );
          await audit(
            pending.workspace_id,
            user,
            "Google connected; account selection required",
          );
        });
        res.redirect("/#oauth=success&workspace=" + pending.workspace_id);
      } catch {
        res.redirect(
          "/#oauth_error=Google%20connection%20failed.%20Check%20your%20access%20and%20reconnect.",
        );
      }
    }),
  );
  app.get(
    "/api/workspaces/:id/ads",
    wrap(async (req, res) => {
      await member(req);
      res.json({
        ads:
          (await db.get(
            "SELECT customer_id,account_name,status,currency_code,connected_at,manager_id FROM eightlm.google_ads WHERE workspace_id=$1",
            req.params.id,
          )) || null,
        oauth:
          (await db.get(
            "SELECT account_email,account_name,connected_at FROM eightlm.oauth_tokens WHERE workspace_id=$1",
            req.params.id,
          )) || null,
        oauth_ready: google.isGoogleOAuthReady(),
        api_configured: Boolean(google.getGoogleAdsDeveloperToken()),
        missing_config: google.getGoogleAdsDeveloperToken()
          ? []
          : ["GOOGLE_ADS_DEVELOPER_TOKEN"],
      });
    }),
  );
  app.get(
    "/api/workspaces/:id/ads/accounts",
    wrap(async (req, res) => {
      await member(req, managers);
      res.json(await google.listAccounts(await token(req.params.id)));
    }),
  );
  app.post(
    "/api/workspaces/:id/ads/customer-id",
    wrap(async (req, res) => {
      await member(req, managers);
      const id = String(req.body.customer_id || "").replace(/-/g, "");
      const managerId = String(req.body.manager_id || "").replace(/-/g, "");
      if (managerId && !/^\d{10}$/.test(managerId))
        throw new google.GoogleError("Manager ID must contain 10 digits.");
      const result = await locked(req, managers, async (user) => {
        const account = await google.accountDetails(
          await token(req.params.id),
          id,
          managerId || null,
        );
        await db.run(
          `INSERT INTO eightlm.google_ads(workspace_id,customer_id,account_name,connected_by,connected_at,status,manager_id,currency_code) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7) ON CONFLICT(workspace_id) DO UPDATE SET customer_id=$2,account_name=$3,connected_by=$4,connected_at=$5,status='ACTIVE',manager_id=$6,currency_code=$7`,
          req.params.id,
          id,
          account.name,
          user.id,
          Date.now(),
          managerId,
          account.currency,
        );
        await audit(req.params.id, user, "Selected Google Ads account " + id);
        return account;
      });
      res.json({
        ok: true,
        customer_id: result.id,
        currency_code: result.currency,
      });
    }),
  );
  app.delete(
    "/api/workspaces/:id/ads",
    wrap(async (req, res) => {
      await member(req, managers);
      await locked(req, managers, async (user) => {
        await db.run(
          "DELETE FROM eightlm.google_ads WHERE workspace_id=$1",
          req.params.id,
        );
        await db.run(
          "DELETE FROM eightlm.oauth_tokens WHERE workspace_id=$1",
          req.params.id,
        );
        await db.run(
          "DELETE FROM eightlm.google_oauth_states WHERE workspace_id=$1",
          req.params.id,
        );
        await audit(
          req.params.id,
          user,
          "Google disconnected; stored credentials removed",
        );
      });
      res.json({ ok: true });
    }),
  );
  for (const path of ["/ads", "/ads/verify", "/auth/google/connect-demo"])
    app.post(
      "/api/workspaces/:id" + path,
      wrap(async (req, res) => {
        await member(req, managers);
        throw new google.GoogleError(
          "Use Connect with Google and select an account. Demo and unverified links are disabled.",
        );
      }),
    );
  app.get(
    "/api/workspaces/:id/ads/campaigns",
    wrap(async (req, res) => {
      await member(req);
      const ads = await connection(req.params.id);
      let apiNotice = null,
        metrics = null;
      try {
        const access = await token(req.params.id),
          rows = await google.fetchCampaigns(
            access,
            ads.customer_id,
            ads.manager_id,
          );
        // Serialize account selection/disconnect with writes; never import into a newly selected account.
        await locked(req, null, async () => {
          const current = await connection(req.params.id);
          if (current.customer_id !== ads.customer_id)
            throw new google.GoogleError("Account changed. Refresh the page.");
          for (const c of rows)
            await db.run(
              `INSERT INTO eightlm.campaigns(id,workspace_id,customer_id,name,channel,status,budget,google_resource,currency_code,publication_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PUBLISHED') ON CONFLICT(workspace_id,id) DO UPDATE SET name=$4,channel=$5,status=$6,budget=$7,google_resource=$8,currency_code=$9,publication_state='PUBLISHED'`,
              ads.customer_id + ":" + c.id,
              req.params.id,
              ads.customer_id,
              c.name,
              c.channel,
              c.status,
              `${ads.currency_code} ${c.budget.toFixed(2)}/day`,
              c.resource,
              ads.currency_code,
            );
        });
        metrics = await google.campaignMetrics(
          access,
          ads.customer_id,
          ads.manager_id,
        );
      } catch (error) {
        apiNotice =
          error instanceof google.GoogleError
            ? error.message
            : "Campaign sync failed. Showing previously saved campaigns.";
      }
      const rows = await db.all(
        "SELECT id,name,channel,status,budget,imported,google_resource,currency_code,publication_state FROM eightlm.campaigns WHERE workspace_id=$1 AND customer_id=$2 ORDER BY name",
        req.params.id,
        ads.customer_id,
      );
      res.json({
        campaigns: rows,
        apiNotice,
        metrics,
        customer_id: ads.customer_id,
        currency_code: ads.currency_code,
        hasDeveloperToken: Boolean(google.getGoogleAdsDeveloperToken()),
        accessibleCustomers: [],
      });
    }),
  );
  app.post(
    "/api/workspaces/:id/ads/campaigns/import",
    wrap(async (req, res) => {
      await member(req, ["Owner", "Admin", "Editor", "Publisher"]);
      const ids = req.body.campaign_ids;
      if (
        !Array.isArray(ids) ||
        ids.length > 500 ||
        ids.some((x) => typeof x !== "string")
      )
        throw new google.GoogleError("Choose valid campaigns.");
      await locked(req, ["Owner", "Admin", "Editor", "Publisher"], async () => {
        const ads = await connection(req.params.id);
        await db.run(
          "UPDATE eightlm.campaigns SET imported=(id=ANY($1::text[])),imported_at=$2 WHERE workspace_id=$3 AND customer_id=$4",
          ids,
          Date.now(),
          req.params.id,
          ads.customer_id,
        );
      });
      res.json({ ok: true, imported_count: ids.length });
    }),
  );
  app.post(
    "/api/workspaces/:id/campaigns/create",
    wrap(async (req, res) => {
      await member(req, ["Owner", "Admin", "Editor", "Publisher"]);
      const payload = google.validateCampaign(req.body);
      const id = randomUUID();
      await locked(req, ["Owner", "Admin", "Editor", "Publisher"], async () => {
        const ads = await connection(req.params.id);
        await db.run(
          "INSERT INTO eightlm.campaign_publications(id,workspace_id,customer_id,payload,created_at) VALUES($1,$2,$3,$4,$5)",
          id,
          req.params.id,
          ads.customer_id,
          JSON.stringify(payload),
          Date.now(),
        );
      });
      res.json({ ok: true, draft: { id, state: "DRAFT" } });
    }),
  );
  async function recordPublished(job, resource, ads, user) {
    await db.run(
      "UPDATE eightlm.campaign_publications SET state='PUBLISHED',resource_name=$1,error=NULL WHERE id=$2",
      resource,
      job.id,
    );
    const p = job.payload;
    await db.run(
      `INSERT INTO eightlm.campaigns(id,workspace_id,customer_id,name,channel,status,budget,imported,imported_at,google_resource,currency_code,publication_state) VALUES($1,$2,$3,$4,'SEARCH','PAUSED',$5,true,$6,$7,$8,'PUBLISHED') ON CONFLICT(workspace_id,id) DO UPDATE SET google_resource=$7,publication_state='PUBLISHED'`,
      job.customer_id + ":" + resource.split("/").pop(),
      job.workspace_id,
      job.customer_id,
      p.name,
      `${ads.currency_code} ${p.budget.toFixed(2)}/day`,
      Date.now(),
      resource,
      ads.currency_code,
    );
    await audit(
      job.workspace_id,
      user,
      "Published paused Search campaign " + resource.split("/").pop(),
    );
  }
  app.post(
    "/api/workspaces/:id/campaigns/:draft/publish",
    wrap(async (req, res) => {
      await member(req, publishers);
      if (!/^[a-f0-9-]{36}$/.test(req.params.draft))
        throw new google.GoogleError("Invalid draft.");
      // Hold a workspace lock through publication, but persist SENDING before the external write.
      // A crash/timeout leaves SENDING; retries reconcile by the unique marker instead of sending twice.
      const result = await locked(req, publishers, async (user) => {
        const job = await db.get(
          "SELECT * FROM eightlm.campaign_publications WHERE id=$1 AND workspace_id=$2",
          req.params.draft,
          req.params.id,
        );
        if (!job) throw new google.GoogleError("Draft not found.", 404);
        if (job.state === "PUBLISHED")
          return { ok: true, resource: job.resource_name, status: "PAUSED" };
        const ads = await connection(req.params.id);
        if (job.customer_id !== ads.customer_id)
          throw new google.GoogleError(
            "Select the original draft account before publishing.",
          );
        const access = await token(req.params.id);
        if (["SENDING", "UNKNOWN"].includes(job.state)) {
          const resource = await google.findPublication(
            access,
            ads.customer_id,
            job.id,
            ads.manager_id,
          );
          if (!resource)
            return {
              ok: false,
              error:
                "Publication outcome is not yet confirmed. Check Google Ads, then check status again. No duplicate request was sent.",
              pending: true,
            };
          await recordPublished(job, resource, ads, user);
          return { ok: true, resource, status: "PAUSED" };
        }
        await google.publishCampaign(
          access,
          ads.customer_id,
          job.payload,
          job.id,
          ads.manager_id,
          true,
        );
        // Independent connection commits the intent before Google can receive the mutation.
        await db.independent(
          "UPDATE eightlm.campaign_publications SET state='SENDING',error=NULL WHERE id=$1",
          job.id,
        );
        let confirmedResource;
        try {
          const response = await google.publishCampaign(
            access,
            ads.customer_id,
            job.payload,
            job.id,
            ads.manager_id,
          );
          const resource = response.mutateOperationResponses?.find(
            (x) => x.campaignResult,
          )?.campaignResult?.resourceName;
          if (!resource)
            throw new google.GoogleError(
              "Google response did not include a campaign ID. Check status before retrying.",
              502,
              true,
            );
          confirmedResource = resource;
        } catch (error) {
          const uncertain =
            !(error instanceof google.GoogleError) || error.uncertain;
          await db.independent(
            "UPDATE eightlm.campaign_publications SET state=$1,error=$2 WHERE id=$3",
            uncertain ? "UNKNOWN" : "DRAFT",
            error instanceof google.GoogleError
              ? error.message
              : "Publication outcome needs reconciliation.",
            job.id,
          );
          return {
            ok: false,
            error:
              error instanceof google.GoogleError
                ? error.message
                : "Could not confirm publication. Check status before retrying.",
            pending: uncertain,
          };
        }
        // If persistence fails, rollback keeps the committed SENDING marker for reconciliation.
        await recordPublished(job, confirmedResource, ads, user);
        return { ok: true, resource: confirmedResource, status: "PAUSED" };
      });
      res.status(result.ok ? 200 : result.pending ? 202 : 400).json(result);
    }),
  );
  app.get(
    "/api/workspaces/:id/campaigns/drafts",
    wrap(async (req, res) => {
      await member(req);
      res.json({
        drafts: await db.all(
          "SELECT id,customer_id,payload,state,resource_name,error,created_at FROM eightlm.campaign_publications WHERE workspace_id=$1 ORDER BY created_at DESC",
          req.params.id,
        ),
      });
    }),
  );
  app.patch(
    "/api/workspaces/:id/campaigns/:cId/status",
    wrap(async (req, res) => {
      await member(req, publishers);
      if (!["ENABLED", "PAUSED"].includes(req.body.status))
        throw new google.GoogleError("Choose Enabled or Paused.");
      await locked(req, publishers, async (user) => {
        const ads = await connection(req.params.id);
        const c = await db.get(
          "SELECT google_resource FROM eightlm.campaigns WHERE workspace_id=$1 AND id=$2 AND customer_id=$3",
          req.params.id,
          req.params.cId,
          ads.customer_id,
        );
        if (!c?.google_resource)
          throw new google.GoogleError(
            "Only confirmed Google campaigns can be updated.",
          );
        await google.updateCampaignStatus(
          await token(req.params.id),
          ads.customer_id,
          c.google_resource,
          req.body.status,
          ads.manager_id,
        );
        await db.run(
          "UPDATE eightlm.campaigns SET status=$1 WHERE workspace_id=$2 AND id=$3",
          req.body.status,
          req.params.id,
          req.params.cId,
        );
        await audit(
          req.params.id,
          user,
          "Google campaign status changed to " + req.body.status,
        );
      });
      res.json({ ok: true, status: req.body.status });
    }),
  );
  app.delete(
    "/api/workspaces/:id/campaigns/:cId",
    wrap(async (req, res) => {
      await member(req, managers);
      await db.run(
        "UPDATE eightlm.campaigns SET imported=false WHERE workspace_id=$1 AND id=$2",
        req.params.id,
        req.params.cId,
      );
      res.json({ ok: true });
    }),
  );
}
