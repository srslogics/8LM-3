import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const files = [
  "server.js",
  "database.js",
  "database-config.js",
  "google-ads.js",
  "workspaces.js",
  ...readdirSync("public")
    .filter((f) => f.endsWith(".js"))
    .map((f) => "public/" + f),
  "scripts/migrate.js",
];
for (const file of files)
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
execFileSync(process.execPath, ["test/login-ui.cjs"], { stdio: "inherit" });
console.log(
  `Build passed: ${files.length} JavaScript files checked; login UI test passed. Static assets are served directly.`,
);
