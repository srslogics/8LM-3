import dotenv from "dotenv";
// Hosted environment variables take precedence over local development files.
dotenv.config({ path: [".env.local", ".env"], quiet: true });
export function databaseUrl(value) {
  if (!value)
    throw new Error(
      "Database connection missing. Run neon deploy or configure DATABASE_URL in Render.",
    );
  const url = new URL(value);
  // Explicit certificate verification avoids changing behavior in future pg releases.
  if (url.hostname.endsWith(".neon.tech"))
    url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
