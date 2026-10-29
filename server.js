import express from "express";
import { workspaceRoutes } from "./workspaces.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { db, pool } from "./database.js";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
await db.get("SELECT 1 AS ready");
const app = express();
app.disable("x-powered-by");
const production = process.env.NODE_ENV === "production";
const appOrigin = new URL(
  process.env.APP_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${process.env.PORT || 8000}`,
).origin;
if (production) app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { "upgrade-insecure-requests": production ? [] : null },
    },
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (
    req.method !== "GET" &&
    (req.get("sec-fetch-site") === "cross-site" ||
      (req.get("origin") && req.get("origin") !== appOrigin))
  )
    return res
      .status(403)
      .json({ error: "Please use the login page to continue." });
  next();
});
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});
const digest = (token) => createHash("sha256").update(token).digest("hex");
const cookieToken = (req) =>
  req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("8lm_session="))
    ?.slice(12);
async function session(req) {
  const token = cookieToken(req);
  return token
    ? await db.get(
        "SELECT eightlm.users.id, eightlm.users.email FROM eightlm.sessions JOIN eightlm.users ON eightlm.users.id=eightlm.sessions.user_id WHERE token=$1 AND expires>$2",
        digest(token),
        Date.now(),
      )
    : null;
}
async function signIn(req, res, user) {
  const old = cookieToken(req);
  if (old)
    await db.run("DELETE FROM eightlm.sessions WHERE token=$1", digest(old));
  await db.run("DELETE FROM eightlm.sessions WHERE expires<=$1", Date.now());
  const token = randomBytes(32).toString("hex");
  await db.run(
    "INSERT INTO eightlm.sessions VALUES ($1,$2,$3)",
    digest(token),
    user.id,
    Date.now() + 7 * 86400000,
  );
  res.cookie("8lm_session", token, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    maxAge: 7 * 86400000,
    path: "/",
  });
  res.json({ user: { email: user.email } });
}
app.post("/api/auth/:action", limiter, async (req, res) => {
  const { action } = req.params;
  if (!["login", "signup"].includes(action)) return res.sendStatus(404);
  const email =
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const password = req.body.password;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    typeof password !== "string" ||
    password.length > 128 ||
    password.length < (action === "signup" ? 12 : 1)
  )
    return res
      .status(400)
      .json({
        error:
          "Enter a valid email. New passwords must contain 12–128 characters.",
      });
  if (action === "signup") {
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt, 64)).toString("hex");
    try {
      const result = await db.run(
        "INSERT INTO eightlm.users(email,salt,password_hash) VALUES($1,$2,$3) RETURNING id",
        email,
        salt,
        hash,
      );
      return signIn(req, res, { id: result.rows[0].id, email });
    } catch (error) {
      if (error.code === "23505")
        return res
          .status(409)
          .json({
            error: "Unable to create this account. Try signing in instead.",
          });
      throw error;
    }
  }
  const user = await db.get(
    "SELECT * FROM eightlm.users WHERE email=$1",
    email,
  );
  const hash = await derive(password, user?.salt || "unregistered-account", 64);
  if (!user || !timingSafeEqual(hash, Buffer.from(user.password_hash, "hex")))
    return res.status(401).json({ error: "Email or password is incorrect." });
  await signIn(req, res, user);
});
app.get("/api/me", async (req, res) => {
  const user = await session(req);
  res.json({ user: user ? { email: user.email } : null });
});
app.post("/api/logout", async (req, res) => {
  const token = cookieToken(req);
  if (token)
    await db.run("DELETE FROM eightlm.sessions WHERE token=$1", digest(token));
  res.clearCookie("8lm_session", { path: "/" });
  res.json({ ok: true });
});
workspaceRoutes(app, db, session);
app.get("/health", async (_req, res) => {
  await db.get("SELECT 1 AS ready");
  res.json({ ok: true });
});
app.use(express.static("public"));
app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.code || error.name);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
const server = app.listen(process.env.PORT || 8000, () =>
  console.log(`8LM ready on port ${process.env.PORT || 8000}`),
);

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
