# Security model

## Boundaries

- Secrets stay server-side. Environment files are ignored; Docker context excludes secrets.
- Login is separate from Google authorization. Every workspace resource checks membership. Owner/Admin manage Google connections; Owner/Admin/Publisher publish/change status; Editor saves drafts; Viewer reads.
- Workspace mutations recheck role under a row lock. Only owners transfer/delete; admins cannot modify owners/admins or appoint admins.
- Invitations are random, hash-only, email-bound, expire after seven days and are consumed transactionally. Link sharing is manual.
- Session cookies: HttpOnly, SameSite=Lax, Path=/, Secure in production. Sessions persist in Postgres.
- Writes reject cross-site Origin/Sec-Fetch-Site. Pydantic validates inputs; request bodies are bounded at 64 KiB.
- CSP, frame protection, MIME protection, no-referrer and production HSTS are emitted. APIs disable caching.
- Shared fixed-window login throttling: 20 attempts/IP/15 minutes, stored in Postgres. Configure proxy trust correctly.

## Google OAuth

State is random, hashed, session/user-bound, expires after ten minutes and is atomically consumed. PKCE uses S256. Workspace permission is rechecked on callback before and after token exchange. Google identity requires verified email; Ads scope and offline refresh token are required. Redirect origin comes from configuration, never Host headers.

Access tokens refresh under a row lock. Disconnect deletes stored tokens and selected account; it does not revoke Google's grant globally, which may affect other workspaces.

## Logging

Application logs record generated request ID, method, status and duration, excluding query strings, cookies, headers and bodies. The start script disables Uvicorn access logs to avoid recording OAuth codes. Unexpected errors log exception type and request ID only. Do not enable HTTPX debug logs in production.

## Release limitations

- OAuth tokens are database columns without application-level envelope encryption. Restrict DB credentials and define key management before adding field encryption.
- Email verification, password recovery, MFA and global account administration are not implemented.
- Fixed-window login throttling does not replace an ingress/WAF limit for malformed traffic or distributed abuse.
- Configure trusted proxy IPs or users may share the proxy's login limit.
- API docs default off. If enabled, OpenAPI JSON is available; interactive Swagger CDN assets may be blocked by the strict CSP.
- Google production approval and live campaign policy acceptance remain external requirements. Automated tests simulate Google responses.
