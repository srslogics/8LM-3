# Migration verification

Executed locally against the isolated Neon branch fix-google-publishing, plus disposable local Postgres in Docker. Production was not migrated.

| Check | Result |
|---|---|
| Ruff lint | All checks passed |
| Ruff formatting | 29 files formatted |
| Python compilation | Passed |
| Unit tests | 11 passed |
| Database/API integration tests | 5 passed across two runs |
| Python Playwright browser workflow | 1 passed |
| Docker image build | Passed |
| Fresh-database container smoke | Passed |
| Dependency audit | No known vulnerabilities reported |
| Dependency lock validation | Passed |

Integration evidence includes existing Node scrypt compatibility, existing session cookie acceptance, sessions across independent app instances, workspace isolation, invitation concurrency/replay, owner/admin restrictions, ownership transfer, OAuth state replay/expiry/session binding/role revocation, refresh, selected currency, atomic paused publication, concurrent retries, lost-response reconciliation, Google status changes, disconnect, CSRF, body limits and shared login throttling.

Docker smoke verified fresh migrations, health, signup, workspace creation, container restart with retained session/data, and logout.

Browser verification exercised the restored nine-step builder, backward navigation, draft-only save, separate paused-publication confirmation, confirmed resource ID, account-response metrics, mobile widths and absence of JavaScript errors. Browser API data and Google HTTP responses were simulated; actual application/database routes were covered separately.

Not verified: live Google campaign acceptance, production Render runtime cutover, or the GitHub-hosted CI run. Those are deployment/external checks, not inferred from local passing tests.
