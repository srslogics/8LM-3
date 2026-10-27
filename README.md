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

Users choose Continue with Google, then Connect Google Ads. Ads consent must use the same Google identity. The app lists directly accessible accounts (including manager accounts) and lets the user select one. It does not traverse manager hierarchies or modify ads. Google provides a broad view/manage Ads scope; the UI explains that permission before consent.

OAuth state, PKCE, nonce and verified ID tokens protect sign-in. Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Tokens stay server-side. Account selection and logout require a same-origin CSRF token. Public files are allowlisted; secrets and source are not served.

This initial single-instance version stores sessions and tokens in server memory for up to eight hours. Restarts, deploys and instance changes require sign-in/reconnection; selected accounts are not durable. Add an encrypted persistent token store and shared session store before multi-instance or unattended operation. Sign-out clears local session tokens; users can revoke Google's authorization in their Google Account permissions.

Password-based login remains unimplemented; Google sign-in is the working authentication method. Live sign-in and Ads access require configured credentials, Google project permissions, and user consent; automated tests use mocked Google responses.
