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

## Campaign type expansion (2026-10-31)

- Contract/operation tests: **33 passed** (Search plus new channel validation, atomic references, cross-account protection and image metadata rejection).
- Browser flows: **5 passed**, one for every supported campaign type; browser payloads are checked against the actual Python request contracts. Desktop/mobile and separate paused-publication confirmation verified.
- Database/API tests on disposable local PostgreSQL: **6 passed**. Includes all four new channels, asset endpoints, viewer denial, channel persistence and duplicate-publication protection.
- Isolated Neon run: **5 passed, 1 failed**. All campaign tests passed; the pre-existing fixed-window throttling test did not reject the 21st call during the slow run spanning a clock window. Full suite passed locally afterward.
- Initial local database run failed because only the pooled URL was overridden while the migration URL still selected Neon; overriding both test URLs resolved the test setup. No application migration changes were needed.
- Ruff, Python compilation, JavaScript syntax and diff whitespace checks passed.

Google HTTP responses are simulated. Live Google validation/acceptance, production deployment and real creative/feed eligibility remain unverified. No live ads were created and these changes have not been pushed.
