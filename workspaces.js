import { randomBytes, createHash } from "node:crypto";
export function workspaceRoutes(app, db, session) {
  /* ── Google Ads connection routes ───────────────── */

  // GET  /api/workspaces/:id/ads  – read connection (any member)
  // POST /api/workspaces/:id/ads  – connect or update (owner/admin)
  // DELETE /api/workspaces/:id/ads – disconnect (owner/admin)

  // Thin helper: verify membership without the heavy workspace lock
  async function adsSession(req, res) {
    const user = await session(req);
    if (!user) { res.status(401).json({ error: "Please log in." }); return null; }
    if (!/^[1-9]\d*$/.test(req.params.id)) { res.status(404).json({ error: "Not found." }); return null; }
    const membership = await db.get(
      "SELECT role FROM eightlm.members WHERE workspace_id=$1 AND user_id=$2",
      req.params.id, user.id,
    );
    if (!membership) { res.status(404).json({ error: "Not found." }); return null; }
    return { user, role: membership.role };
  }

  app.get("/api/workspaces/:id/ads", async (req, res) => {
    const ctx = await adsSession(req, res);
    if (!ctx) return;
    const row = await db.get(
      "SELECT customer_id, account_name, connected_at FROM eightlm.google_ads WHERE workspace_id=$1",
      req.params.id,
    );
    res.json({ ads: row || null });
  });

  app.post("/api/workspaces/:id/ads", async (req, res) => {
    const ctx = await adsSession(req, res);
    if (!ctx) return;
    if (!["Owner", "Admin"].includes(ctx.role))
      return res.status(403).json({ error: "Only owners and admins can connect accounts." });

    // Normalise customer ID: accept 123-456-7890 or 1234567890
    const raw = typeof req.body.customer_id === "string" ? req.body.customer_id.replace(/-/g, "").trim() : "";
    const accountName = typeof req.body.account_name === "string" ? req.body.account_name.trim().slice(0, 120) : "";
    if (!/^\d{10}$/.test(raw))
      return res.status(400).json({ error: "Enter a valid 10-digit Google Ads Customer ID." });

    const formatted = `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    await db.run(
      `INSERT INTO eightlm.google_ads(workspace_id, customer_id, account_name, connected_by, connected_at)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(workspace_id) DO UPDATE
         SET customer_id=$2, account_name=$3, connected_by=$4, connected_at=$5`,
      req.params.id, formatted, accountName, ctx.user.id, Date.now(),
    );
    await db.run(
      "INSERT INTO eightlm.activity(workspace_id,actor,action,created) VALUES($1,$2,$3,$4)",
      req.params.id, ctx.user.email, `Google Ads account ${formatted} connected`, Date.now(),
    );
    res.json({ ok: true, customer_id: formatted });
  });

  app.delete("/api/workspaces/:id/ads", async (req, res) => {
    const ctx = await adsSession(req, res);
    if (!ctx) return;
    if (!["Owner", "Admin"].includes(ctx.role))
      return res.status(403).json({ error: "Only owners and admins can disconnect accounts." });
    await db.run("DELETE FROM eightlm.google_ads WHERE workspace_id=$1", req.params.id);
    await db.run(
      "INSERT INTO eightlm.activity(workspace_id,actor,action,created) VALUES($1,$2,$3,$4)",
      req.params.id, ctx.user.email, "Google Ads account disconnected", Date.now(),
    );
    res.json({ ok: true });
  });
  const roles = ["Admin", "Editor", "Publisher", "Viewer"];
  const audit = async (w, u, a) =>
    await db.run(
      "INSERT INTO eightlm.activity(workspace_id,actor,action,created) VALUES($1,$2,$3,$4)",
      w,
      u.email,
      a,
      Date.now(),
    );
  const name = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 80
      ? value.trim()
      : null;
  const create = db.transaction(async (user, title) => {
    const id = Number(
      (
        await db.run(
          "INSERT INTO eightlm.workspaces(name) VALUES($1) RETURNING id",
          title,
        )
      ).rows[0].id,
    );
    await db.run(
      "INSERT INTO eightlm.members VALUES($1,$2,$3)",
      id,
      user.id,
      "Owner",
    );
    await audit(id, user, "Workspace created");
    return id;
  });
  const ensure = db.transaction(async (user) => {
    await db.get(
      "SELECT id FROM eightlm.users WHERE id=$1 FOR UPDATE",
      user.id,
    );
    if (
      !(await db.get("SELECT 1 FROM eightlm.members WHERE user_id=$1", user.id))
    )
      await create(user, "My workspace");
  });
  app.use("/api/workspaces", async (req, res, next) => {
    req.user = await session(req);
    if (!req.user) return res.status(401).json({ error: "Please log in." });
    await ensure(req.user);
    next();
  });
  app.get("/api/workspaces", async (req, res) =>
    res.json({
      workspaces: await db.all(
        "SELECT w.id,w.name,m.role FROM eightlm.workspaces w JOIN eightlm.members m ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.id",
        req.user.id,
      ),
    }),
  );
  app.post("/api/workspaces", async (req, res) => {
    const title = name(req.body.name);
    if (!title)
      return res
        .status(400)
        .json({ error: "Enter a workspace name (1–80 characters)." });
    res.json({ id: await create(req.user, title) });
  });
  app.post("/api/workspaces/accept", async (req, res) => {
    if (typeof req.body.token !== "string" || req.body.token.length !== 64)
      return res.status(400).json({ error: "Invalid invitation." });
    const hash = createHash("sha256").update(req.body.token).digest("hex");
    const result = await db.transaction(async () => {
      const found = await db.get(
        "SELECT workspace_id FROM eightlm.invites WHERE hash=$1",
        hash,
      );
      if (!found) return null;
      await db.get(
        "SELECT id FROM eightlm.workspaces WHERE id=$1 FOR UPDATE",
        found.workspace_id,
      );
      const invite = await db.get(
        "SELECT * FROM eightlm.invites WHERE hash=$1 AND expires>$2 FOR UPDATE",
        hash,
        Date.now(),
      );
      if (!invite || invite.email !== req.user.email) return null;
      await db.run(
        "INSERT INTO eightlm.members VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        invite.workspace_id,
        req.user.id,
        invite.role,
      );
      await db.run("DELETE FROM eightlm.invites WHERE id=$1", invite.id);
      await audit(invite.workspace_id, req.user, "Invitation accepted");
      return invite.workspace_id;
    })();
    if (!result)
      return res
        .status(400)
        .json({
          error:
            "Invitation expired, already used, or addressed to another email.",
        });
    res.json({ id: result });
  });
  // Lock the workspace before checking roles, so concurrent ownership changes
  // cannot authorize a mutation using an outdated membership. Commit before replying.
  const route = (method, path, ...handlers) =>
    app[method](path, async (req, res) => {
      const result = await db.transaction(async () => {
        if (!/^[1-9]\d*$/.test(req.params.id))
          return { status: 404, body: { error: "Workspace not found." } };
        const workspace = await db.get(
          "SELECT * FROM eightlm.workspaces WHERE id=$1 FOR UPDATE",
          req.params.id,
        );
        const membership =
          workspace &&
          (await db.get(
            "SELECT role FROM eightlm.members WHERE workspace_id=$1 AND user_id=$2",
            workspace.id,
            req.user.id,
          ));
        if (!membership)
          return { status: 404, body: { error: "Workspace not found." } };
        req.workspace = { ...workspace, role: membership.role };
        const reply = { status: 200, body: null };
        const response = {
          status(code) {
            reply.status = code;
            return this;
          },
          json(body) {
            reply.body = body;
            return this;
          },
          sendStatus(code) {
            reply.status = code;
            reply.body = {
              error: code === 403 ? "Access denied." : "Not found.",
            };
            return this;
          },
        };
        const run = async (index) => {
          if (handlers[index])
            await handlers[index](req, response, () => run(index + 1));
        };
        await run(0);
        return reply;
      })();
      res.status(result.status).json(result.body);
    });
  const manage = async (req, res, next) =>
    ["Owner", "Admin"].includes(req.workspace.role)
      ? next()
      : res
          .status(403)
          .json({ error: "Only owners and admins can manage members." });
  const owner = async (req, res, next) =>
    req.workspace.role === "Owner"
      ? next()
      : res.status(403).json({ error: "Only the owner can do this." });
  route("get", "/api/workspaces/:id", async (req, res) =>
    res.json({
      workspace: req.workspace,
      members: await db.all(
        "SELECT u.id,u.email,m.role FROM eightlm.members m JOIN eightlm.users u ON u.id=m.user_id WHERE workspace_id=$1",
        req.workspace.id,
      ),
      invites: ["Owner", "Admin"].includes(req.workspace.role)
        ? await db.all(
            "SELECT id,email,role,expires FROM eightlm.invites WHERE workspace_id=$1 AND expires>$2",
            req.workspace.id,
            Date.now(),
          )
        : [],
      activity: await db.all(
        "SELECT actor,action,created FROM eightlm.activity WHERE workspace_id=$1 ORDER BY id DESC LIMIT 50",
        req.workspace.id,
      ),
    }),
  );
  route("patch", "/api/workspaces/:id", manage, async (req, res) => {
    const title = name(req.body.name);
    if (!title)
      return res.status(400).json({ error: "Enter a valid workspace name." });
    await db.transaction(async () => {
      await db.run(
        "UPDATE eightlm.workspaces SET name=$1 WHERE id=$2",
        title,
        req.workspace.id,
      );
      await audit(req.workspace.id, req.user, `Workspace renamed to ${title}`);
    })();
    res.json({ ok: true });
  });
  route("post", "/api/workspaces/:id/invites", manage, async (req, res) => {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const role = req.body.role;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !roles.includes(role) ||
      (role === "Admin" && req.workspace.role !== "Owner")
    )
      return res
        .status(400)
        .json({
          error:
            "Choose a valid email and allowed role. Only owners can appoint admins.",
        });
    if (
      await db.get(
        "SELECT 1 FROM eightlm.members m JOIN eightlm.users u ON m.user_id=u.id WHERE workspace_id=$1 AND email=$2",
        req.workspace.id,
        email,
      )
    )
      return res.status(409).json({ error: "This user is already a member." });
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    await db.transaction(async () => {
      await db.run(
        "DELETE FROM eightlm.invites WHERE workspace_id=$1 AND email=$2",
        req.workspace.id,
        email,
      );
      await db.run(
        "INSERT INTO eightlm.invites(workspace_id,email,role,hash,expires) VALUES($1,$2,$3,$4,$5)",
        req.workspace.id,
        email,
        role,
        hash,
        Date.now() + 7 * 86400000,
      );
      await audit(req.workspace.id, req.user, `Invited ${email} as ${role}`);
    })();
    res.json({ token });
  });
  route(
    "delete",
    "/api/workspaces/:id/invites/:invite",
    manage,
    async (req, res) => {
      const invite = await db.get(
        "SELECT * FROM eightlm.invites WHERE id=$1 AND workspace_id=$2",
        req.params.invite,
        req.workspace.id,
      );
      if (!invite) return res.sendStatus(404);
      if (invite.role === "Admin" && req.workspace.role !== "Owner")
        return res.sendStatus(403);
      await db.transaction(async () => {
        await db.run("DELETE FROM eightlm.invites WHERE id=$1", invite.id);
        await audit(
          req.workspace.id,
          req.user,
          `Invitation revoked for ${invite.email}`,
        );
      })();
      res.json({ ok: true });
    },
  );
  const target = async (req, res, next) => {
    req.member = await db.get(
      "SELECT * FROM eightlm.members WHERE workspace_id=$1 AND user_id=$2",
      req.workspace.id,
      req.params.user,
    );
    if (!req.member)
      return res.status(404).json({ error: "Member not found." });
    if (
      req.member.role === "Owner" ||
      (req.workspace.role !== "Owner" && req.member.role === "Admin")
    )
      return res.status(403).json({ error: "You cannot change this member." });
    return next();
  };
  route(
    "patch",
    "/api/workspaces/:id/members/:user",
    manage,
    target,
    async (req, res) => {
      const role = req.body.role;
      if (
        !roles.includes(role) ||
        (role === "Admin" && req.workspace.role !== "Owner")
      )
        return res.status(403).json({ error: "Role not allowed." });
      await db.transaction(async () => {
        await db.run(
          "UPDATE eightlm.members SET role=$1 WHERE workspace_id=$2 AND user_id=$3",
          role,
          req.workspace.id,
          req.member.user_id,
        );
        await audit(
          req.workspace.id,
          req.user,
          `Member ${req.member.user_id} role changed to ${role}`,
        );
      })();
      res.json({ ok: true });
    },
  );
  route(
    "delete",
    "/api/workspaces/:id/members/:user",
    manage,
    target,
    async (req, res) => {
      await db.transaction(async () => {
        await db.run(
          "DELETE FROM eightlm.members WHERE workspace_id=$1 AND user_id=$2",
          req.workspace.id,
          req.member.user_id,
        );
        await audit(
          req.workspace.id,
          req.user,
          `Member ${req.member.user_id} removed`,
        );
      })();
      res.json({ ok: true });
    },
  );
  route("post", "/api/workspaces/:id/transfer", owner, async (req, res) => {
    if (
      !Number.isSafeInteger(req.body.user) ||
      req.body.user === req.user.id ||
      !(await db.get(
        "SELECT 1 FROM eightlm.members WHERE workspace_id=$1 AND user_id=$2",
        req.workspace.id,
        req.body.user,
      ))
    )
      return res.status(400).json({ error: "Choose another existing member." });
    await db.transaction(async () => {
      await db.run(
        "UPDATE eightlm.members SET role='Admin' WHERE workspace_id=$1 AND user_id=$2",
        req.workspace.id,
        req.user.id,
      );
      await db.run(
        "UPDATE eightlm.members SET role='Owner' WHERE workspace_id=$1 AND user_id=$2",
        req.workspace.id,
        req.body.user,
      );
      await audit(
        req.workspace.id,
        req.user,
        `Ownership transferred to member ${req.body.user}`,
      );
    })();
    res.json({ ok: true });
  });
  route("delete", "/api/workspaces/:id", owner, async (req, res) => {
    if (req.body.name !== req.workspace.name)
      return res
        .status(400)
        .json({ error: "Type the workspace name to confirm deletion." });
    await db.run(
      "DELETE FROM eightlm.workspaces WHERE id=$1",
      req.workspace.id,
    );
    res.json({ ok: true });
  });
}
