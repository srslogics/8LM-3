# 8LM-3

Login page with server-side Google sign-in and Google Ads account connection.

## Local setup

Run `npm ci`, copy `.env.example` to `.env`, fill in OAuth settings and a random session secret, then run `npm start`. Open http://localhost:8000. Run `npm test` for mocked OAuth integration checks.

## Render environment

Create a Node Web Service with build command `npm ci` and start command `npm start`.

In the service's Environment settings, set:

| Variable | Value |
| --- | --- |
| GOOGLE_CLIENT_ID | Your Google Web application OAuth client ID |
| GOOGLE_CLIENT_SECRET | The matching client secret |
| APP_ORIGIN | https://eightlm-3.onrender.com |
| SESSION_SECRET | Random secret of at least 32 characters; use a password generator |
| GOOGLE_ADS_API_VERSION | v26 (optional; default) |

Never commit real credentials. Save environment changes and redeploy. Render supplies PORT automatically.

## Google Cloud setup

Use project `lm-3-demo`, OAuth client type Web application. Authorized origin: `https://eightlm-3.onrender.com`. Exact authorized redirect URI: `https://eightlm-3.onrender.com/auth/google/callback`. For local testing also add `http://localhost:8000/auth/google/callback`.

Enable Google Ads API in that same project. Configure the consent screen for the intended audience, add test users while in Testing, and declare openid, email, profile, and `https://www.googleapis.com/auth/adwords`. External public use may require Google's verification. Internal audience restricts sign-in to the organization's users.

Google's September 2026 migration moved Ads API access levels to Cloud projects. Enable the API and apply for appropriate access to real accounts in the project's Google Ads API Overview; developer tokens are no longer required.

Sources: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/google-ads/api/docs/api-policy/developer-token

## Behavior and limits

Users choose Continue with Google, then Connect Google Ads. Ads consent must use the same Google identity. The app lists directly accessible accounts (including manager accounts) and lets the user select one. The dashboard discovers enabled client accounts under a selected manager and validates client access before reporting. It does not modify ads. Google provides a broad view/manage Ads scope; the UI explains that permission before consent.

OAuth state, PKCE, nonce and verified ID tokens protect sign-in. Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Tokens stay server-side. Account selection and logout require a same-origin CSRF token. Public files are allowlisted; secrets and source are not served.

With REDIS_URL configured, sessions and Google tokens are stored in Render Key Value with AES-256-GCM encryption derived from SESSION_SECRET and an eight-hour session expiry. Keep SESSION_SECRET stable across deployments and instances. Changing it invalidates existing sessions. Sign-out deletes the shared session. Without REDIS_URL, the app retains its temporary single-process fallback and prints a warning. A configured but unavailable Redis store fails startup rather than silently falling back.

Create Render Key Value in the same workspace and region as the web service, then copy its internal connection URL into the web service's REDIS_URL environment variable. Save and redeploy. Paid Key Value supports disk-backed persistence; free-instance restarts can lose sessions. No Key Value resource is created by this repository. Keep the connection URL private. See https://render.com/docs/key-value.

Sign-out clears local authorization; users can revoke Google's authorization in their Google Account permissions.

Password-based login remains unimplemented; Google sign-in is the working authentication method. Live sign-in and Ads access require configured credentials, Google project permissions, and user consent; automated tests use mocked Google responses.

## Campaign dashboard

Selecting an account opens campaign performance with spend, impressions, clicks, conversions, CTR, and average CPC. Date ranges are last 7 days, last 30 days, this month, and last month. The last 7/30 day ranges exclude today. Reports follow the Google Ads account time zone and currency. Removed campaigns are excluded from both rows and totals. Search filters the table only; summary cards remain account totals for the chosen period.

Reporting uses server-side Google Ads SearchStream queries and handles all response batches. Manager accounts show an enabled-client selector; the server checks the manager's current client list before accessing a client with the login-customer-id header. Access and reporting failures show errors instead of zero metrics. Reloading defaults to the selected account and last 30 days; manager client choice and date filters are not persisted.

Run `npm test` for mocked OAuth, reporting calculations, reporting failures, range validation and cross-account access checks. Live data verification requires the deployed service and an authorized user session.

## Search campaign builder

Use Create Search campaign on a client dashboard. The builder supports one current draft per Google user/account, one ad group and responsive search ad, manual CPC, phrase/exact keywords, English, and country targeting for India, United States or United Kingdom. Drafts use Redis when configured; without it, they are temporary and single-process. Creating another draft replaces the current draft record, not the Google campaign.

Review budget (account currency), bid, creative and targeting, then explicitly publish. The server rechecks client access, validates the draft and sends validateOnly to Google before one atomic mutation. Campaigns are always PAUSED; enabling/spending is not supported here. Google policy review and account permissions still apply.

Publication locks block concurrent requests. Ambiguous network outcomes remain blocked rather than retrying and risking duplicates; check Google Ads for the unique [8LM draft-ID] campaign-name suffix before administrator reconciliation. Do not delete a publication lock until confirming the outcome. Live campaign creation has not been executed during development. Tests cover draft validation, mutation assembly, amount conversion and local repository locking; production Redis and Google mutation require deployment verification.

## Remembered Google Ads connections

With Redis configured, encrypted Google Ads credentials and selected account are also stored separately from the login session, keyed by verified Google subject and OAuth client ID. Signing out ends the login session; signing in again restores the Ads connection. Keep SESSION_SECRET stable. Redis data loss, revoked Google authorization, or expired refresh tokens still require reconnection. Existing sessions migrate when they next save connection state (for example, refreshing campaign data). Revoke access through Google Account permissions to invalidate a remembered grant.
