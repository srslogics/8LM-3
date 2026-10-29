# Deployment and migration runbook

## Before cutover

1. Keep working Node release 97adfb1 available for rollback.
2. Confirm Neon backups/restore retention; use an isolated test branch.
3. Set the production pooled/direct database URLs. Do not copy local test-branch URLs.
4. Preserve hostname, database and cookie name to retain sessions. New hostnames require login again.
5. Keep Google credentials and register the exact callback https://YOUR_HOST/api/auth/google/callback. Update APP_ORIGIN and Google together if the hostname changes.

## Render native Python

Use a Python 3 web service (Python 3.13 recommended):

| Setting | Value |
|---|---|
| Build | pip install --require-hashes -r requirements.txt |
| Start | sh scripts/start.sh |
| Health | /health |
| APP_ENV | production |
| APP_ORIGIN | Exact HTTPS origin, or RENDER_EXTERNAL_URL |
| Database | Existing production pooled/direct URLs |
| Google | Existing client ID, client secret, developer token |

Replace the old Node build/start commands. render.yaml describes a new Python service; it does not silently convert an existing Node service or move its hostname. Perform service/runtime cutover in Render before directing users to Python.

FORWARDED_ALLOW_IPS controls Uvicorn proxy trust. Trust only the actual ingress. Use * only where hosting blocks direct untrusted access. Otherwise IP throttling may group users under the proxy IP.

## Docker alternative

Build with docker build -t eightlm . and inject secrets at runtime. The image runs non-root and uses the same start script. Set Render runtime to Docker. The base tag receives updates; pin an approved image digest in your release pipeline if exact image reproducibility is required.

## Migrations

python -m app.db.migrate takes advisory lock 84930271, uses eightlm.migrations and applies new SQL files transactionally. Never rename/edit applied migrations. Migration 010 adds login throttling only. Python migration does not delete users, grants or campaigns.

The start script migrates before Uvicorn to support low-cost single-service deployment. Platforms with a pre-deploy phase may migrate there instead. Do not run migrations independently in every worker.

## Smoke checks

- /health returns 200.
- Existing login and same-host sessions work.
- Membership, invites and role restrictions work.
- Google reconnect/account selection works.
- Publish reviewed content paused; verify complete resources and ID in Google Ads. Automated tests do not prove this external step.
- Reports use the correct account/currency.

## Rollback

Stop Python traffic; redeploy Node 97adfb1 with its original commands. Migration 010 is additive and can remain. Do not delete Neon data. Sessions and password formats are compatible in both directions.

## Dependency updates

Run uv lock, then uv sync --frozen --extra dev. Export production requirements:

~~~sh
uv export --no-dev --no-emit-project --format requirements-txt --output-file requirements.txt
~~~

Run lint, unit/integration/browser checks and dependency audit before committing lock files.
