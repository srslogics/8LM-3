import { databaseUrl } from "../database-config.js";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
const connectionString = databaseUrl(
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
);
if (!connectionString)
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");
const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 15000,
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(84930271)");
  await client.query("CREATE SCHEMA IF NOT EXISTS eightlm");
  await client.query(
    "CREATE TABLE IF NOT EXISTS eightlm.migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await client.query("SELECT 1 FROM eightlm.migrations WHERE name=$1", [
          name,
        ])
      ).rowCount
    )
      continue;
    await client.query(
      await readFile(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
    await client.query("INSERT INTO eightlm.migrations(name) VALUES($1)", [
      name,
    ]);
    console.log("Applied migration:", name);
  }
  await client.query("COMMIT");
  console.log("Database migrations complete.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migration failed:", error.code || error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
