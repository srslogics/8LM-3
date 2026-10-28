import { databaseUrl } from "./database-config.js";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required. Run neon deploy or configure it in Render.",
  );
export const pool = new pg.Pool({
  connectionString: databaseUrl(process.env.DATABASE_URL),
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});
pool.on("error", (error) =>
  console.error("Database connection error:", error.code || "unknown"),
);
const context = new AsyncLocalStorage();
const query = (sql, values) => (context.getStore() || pool).query(sql, values);
export const db = {
  get: async (sql, ...values) => (await query(sql, values)).rows[0],
  all: async (sql, ...values) => (await query(sql, values)).rows,
  run: (sql, ...values) => query(sql, values),
  transaction:
    (fn) =>
    async (...args) => {
      if (context.getStore()) return fn(...args);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await context.run(client, () => fn(...args));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
};
