# 8LM — accounts and workspaces

8LM is an Express application with email/password authentication and workspace access management. PostgreSQL on Neon stores users, password hashes, sessions, workspaces, memberships, invitations, and activity. No Render disk or Google Cloud service is needed for these features.

## Local setup

Use Node.js 22.20 or newer.

1. Run `npm ci`.
2. Run `neon init -y --org-id org-polished-bird-87927647 --project-id square-wave-65440354 --branch production --services postgres`, then `neon deploy`.
3. Run `npm run migrate`, then `npm run build` and `npm start`.
4. Open http://localhost:8000.

Neon writes connection strings to ignored `.env.local` (or `.env`). Existing environment variables take precedence. The application uses pooled `DATABASE_URL` with node-postgres, appropriate for a long-running Express process. Migrations use `DATABASE_URL_UNPOOLED`. Credentials stay server-side. Neon TLS certificates are explicitly verified.

`neon deploy` configures the database and retrieves environment variables; it does not deploy this Express application to Render. PostgreSQL is the only configured Neon service. Existing 8LM authentication remains in place.

## Render settings

- Runtime: Node; Node version 22.20 or newer.
- Build command: `npm ci && npm run build`
- Start command: `npm run migrate && npm start`
- Health check: `/health`
- Environment: `NODE_ENV=production`; copy `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from the **production** Neon branch to Render's Environment settings.
- `APP_ORIGIN` is optional when using Render's default URL; for a custom domain, set its exact HTTPS origin. Render's provided `PORT` is used automatically.
- Remove obsolete `DATABASE_PATH`; no persistent disk is required. Never put connection strings in source control or browser code.

Deploy the updated code and environment together. Render redeploys restart the app but do not erase Neon data. Seven-day sessions also live in Neon; they remain valid across restarts until expiry or sign-out. Back up any surviving SQLite database before replacing the old deployment. This migration creates a new Postgres schema; it does **not** automatically copy old SQLite accounts or recover data already lost on Render.

## Database changes and tests

Versioned SQL lives in `migrations/`. `npm run migrate` applies each migration once, in a transaction, with a migration lock. App tables use the `eightlm` schema to avoid other project tables. Workspace changes and permission checks run together under a workspace lock. Invite acceptance is single-use even under concurrent requests.

For development, use `neon checkout <test-branch> --create` before schema changes. Test there, then `neon checkout production` and apply the reviewed migrations. Both commands pull the selected branch's connection strings.

- `npm run build`: checks all application JavaScript and the signup/login UI regression. This app serves static files directly; no bundler is needed.
- `npm run test:neon`: starts the real app, verifies database writes and password/session hashing, restarts the process, checks persisted login/workspace access, then verifies logout and password login. Removes its own fixtures.
- With an isolated test-branch server running: `TEST_BASE_URL=http://localhost:8017 python3 test/workspaces.py`. Checks workspace isolation, invite ownership/replay, role restrictions, transfer, and deletion. This test leaves fixture users on the test branch; do not run it against production.

## Access model

Users can create/switch/rename workspaces, invite members, revoke invitations, assign roles, remove members, transfer ownership, and delete workspaces. Membership is checked on every request. Admins cannot manage owners or other admins, or appoint admins. Only owners transfer ownership or delete a workspace. Deleting a workspace deletes its memberships, invitations and activity.

Invitations expire after seven days and require login with the addressed email. Only invitation token hashes are stored. The inviter shares the link; no email delivery is configured. Email verification and password recovery are not implemented. Editor, Publisher and Viewer cannot manage membership; campaign-specific distinctions await the Ads module. Authentication rate limiting remains per-process; shared limits are needed before horizontal scaling.
