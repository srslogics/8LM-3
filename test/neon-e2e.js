import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { db, pool } from "../database.js";
const port = process.env.TEST_PORT || "8016";
const base = `http://localhost:${port}`;
const email = `neon-e2e-${randomUUID()}@example.com`;
const password = "Neon-test-password-123!";
let child,
  cookie = "",
  workspaceId;
async function start() {
  child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: port, NODE_ENV: "test", APP_ORIGIN: base },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("App failed: " + output);
    try {
      if ((await fetch(base + "/health")).ok) {
        console.log("App started; Neon health check passed.");
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("App startup timed out: " + output);
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await done;
  }
}
async function call(path, method = "GET", body) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, data: await response.json() };
}
try {
  await start();
  assert.equal(
    (await call("/auth/signup", "POST", { email, password })).status,
    200,
  );
  assert.equal(
    (await call("/auth/signup", "POST", { email, password })).status,
    409,
  );
  const stored = await db.get(
    "SELECT * FROM eightlm.users WHERE email=$1",
    email,
  );
  assert.ok(stored);
  assert.notEqual(stored.password_hash, password);
  const savedSession = await db.get(
    "SELECT token FROM eightlm.sessions WHERE user_id=$1",
    stored.id,
  );
  assert.ok(savedSession);
  assert.notEqual(savedSession.token, cookie.split("=")[1]);
  const list = await call("/workspaces");
  assert.equal(list.status, 200);
  workspaceId = list.data.workspaces[0].id;
  assert.equal(
    (
      await call(`/workspaces/${workspaceId}`, "PATCH", {
        name: "Neon persistence test",
      })
    ).status,
    200,
  );
  console.log(
    "Passed: signup, duplicate rejection, hashed passwords/sessions, workspace write to Neon.",
  );
  await stop();
  await start();
  assert.equal((await call("/me")).data.user.email, email);
  const detail = await call(`/workspaces/${workspaceId}`);
  assert.equal(detail.data.workspace.name, "Neon persistence test");
  assert.equal(detail.data.members[0].role, "Owner");
  assert.ok(detail.data.activity.length >= 2);
  console.log(
    "Passed: account, session, workspace, membership and activity survive an app restart.",
  );
  assert.equal((await call("/logout", "POST", {})).status, 200);
  assert.equal((await call("/me")).data.user, null);
  assert.equal(
    (await call("/auth/login", "POST", { email, password: "incorrect" }))
      .status,
    401,
  );
  assert.equal(
    (await call("/auth/login", "POST", { email, password })).status,
    200,
  );
  console.log(
    "Passed: logout, invalid-password rejection, login after restart.",
  );
} finally {
  await stop();
  if (workspaceId)
    await db.run("DELETE FROM eightlm.workspaces WHERE id=$1", workspaceId);
  await db.run("DELETE FROM eightlm.users WHERE email=$1", email);
  await pool.end();
  console.log("E2E test fixtures removed.");
}
