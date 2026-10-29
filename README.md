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

Invitations expire after seven days and require login with the addressed email. Only invitation token hashes are stored. The inviter shares the link; no email delivery is configured. Email verification and password recovery are not implemented. Editor, Publisher and Viewer cannot manage membership; Editors can save campaign drafts; Owners, Admins and Publishers can publish and change campaign status. Only Owners and Admins can connect/disconnect Google and choose the advertising account. Authentication rate limiting remains per-process; shared limits are needed before horizontal scaling.

## Google Ads: connection and publishing

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ADS_DEVELOPER_TOKEN` in Render. Register **https://eightlm-3.onrender.com/api/auth/google/callback** as the OAuth web client's redirect URI (use your own origin if different). Enable the Google Ads API in that Cloud project and obtain production access for real accounts. Authentication for 8LM remains separate from Google authorization.

After migration 009, connect Google from the Google Ads page, grant Ads/offline access, then select an accessible advertising account. Manager accounts are used to discover client accounts, not as campaign destinations. Existing real connections can continue if valid; demo links are removed. An expired or revoked grant requires reconnecting.

OAuth state is random, hashed, single-use, expires after ten minutes, and is bound to the authenticated user and browser session. PKCE and callback-time workspace permission checks prevent cross-workspace substitution. Tokens remain server-side in Postgres and refresh automatically. Disconnect removes stored tokens and the account selection; it does not revoke Google's grant globally, which could affect other workspace connections.

The Search builder saves a draft first. Publication requires a separate confirmation and Publisher/Admin/Owner access. The server validates fields and sends Google's validate-only request before an atomic mutation creates the budget, paused Search campaign, ad group, location, keywords and responsive search ad. Campaigns are paused so publication alone does not start spending. Supported options: Manual CPC, phrase/exact keywords, India/US/UK presence targeting, Search only, non-EU-political ads. Other campaign types and CM360 are not implemented by this flow.

A durable publication marker is recorded before the request. Concurrent submissions are serialized. An interrupted response is reconciled by the unique campaign-name marker, never automatically republished. If status remains uncertain, inspect Google Ads before further action. Do not rename the marker-bearing campaign until reconciliation completes. A reported success includes Google's resource ID. Enabling/pausing confirmed campaigns also calls Google; untracking only removes them from 8LM's tracked list.

Campaign lists and account totals come from Google, scoped to the selected customer with its actual currency. Missing reporting data is shown as unavailable, never fabricated. Google policy review, permissions, billing and quota checks still apply.

### Verification

- `npm run test:google`: on an isolated Neon branch, exercises real database-backed routes with simulated Google responses: OAuth security, refresh, permissions, full publish payload, duplicate prevention, response-loss reconciliation, reporting and disconnect.
- `npm run test:google-ui`: with the local app at port 8018 and Chrome installed, checks the browser flow with fixture API responses. It captures previews under `../outputs/`.
- These tests do not prove live Google acceptance. Verify a real paused publication after deployment using an authorized account and approved campaign content.
