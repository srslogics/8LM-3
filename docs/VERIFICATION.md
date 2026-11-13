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

## Meta Ads integration (2026-11-09)

- `python -m pytest --integration -q`: **51 passed, 7 browser tests skipped** on a
  disposable local PostgreSQL 17 database; both database URLs explicitly isolated.
- Browser suite: **7 passed** (five existing Google builders, Meta Owner and Viewer).
- Meta coverage: session-bound OAuth and replay denial, scope rejection, encrypted
  storage, expiry, workspace and role enforcement, account/asset binding, reporting
  failure visibility, campaign import validation, four-step paused publication,
  definite failure/resume, lost response/reconciliation, unresolved response without
  resend, concurrent publication retries, pagination host restriction and log redaction.
- Ruff lint/format, Python compilation, JS syntax, lock consistency and diff checks pass.

Meta Graph responses and browser API responses are simulated. PostgreSQL and API
integration routes are real. No live Meta token, reporting request or ad creation
was tested: these require the configured Meta app and user authorization. Production
Render deployment and external API acceptance must be checked after deployment.

## Meta campaign editor expansion (2026-11-09)

- Isolated PostgreSQL suite: 56 passed, 8 browser tests skipped.
- Browser suite: 8 passed, including Traffic and Sales owner flows, viewer access,
  and all five Google campaign builders.
- Sales contract validates dataset requirement, age order, time-zone-aware dates
  and future end date. Integration checks dataset account access, conversion event,
  campaign budget placement and audience values in the outbound Graph requests.
- Initial database run started before the disposable PostgreSQL container was
  ready and failed setup; rerunning after startup passed. No production data used.
- Live Meta Sales acceptance and tracking/event eligibility remain unverified.

## Meta screenshot layout rebuild (2026-11-09)

- Objective/manual setup onboarding and full-screen Campaign → Ad set → Ad editor
  replace the previous inline wizard. Desktop hierarchy, inspector, sticky header,
  fixed footer and mobile Review layout were inspected in browser screenshots.
- Browser checks: eight passed, including five Google regressions and the Meta
  Traffic/Sales/Viewer flows. After correcting focus scrolling, all three Meta
  checks passed again. Tests assert header/footer placement, live age errors,
  draft-only saving and separate paused publication.
- Unit suite: 43 passed, 21 opt-in integration/browser checks skipped. Backend
  publishing contracts and operations are unchanged by this layout rebuild.

## Shared application layout and navigation (2026-11-09)

The shared shell now has a dedicated shell.css, consistent typography/spacing and a
mobile drawer instead of a wrapped sidebar. Browser coverage exercises opening,
Escape dismissal, selected-page navigation and menu close on selection. The member
page identifies its purpose and workspace separately. Desktop/mobile member screens
were inspected. All eight Google/Meta browser flows passed; 43 unit checks passed
(21 opt-in checks skipped). One initial browser run timed out during Shopping boot;
the complete rerun passed. External Google font loading was removed because the
application uses system fonts. Feature editor layouts retain scoped styles.

## Campaign platform routing (2026-11-09)

Campaigns now exposes Google Ads and Meta Ads platform selectors. Without an
explicit choice, a workspace with Meta connected and no selected Google account
opens Meta. Explicit choices are kept per workspace during the session; workspace
names are not used for routing. Meta displays its own reporting, imports, drafts,
publication history and campaign builder under the Campaigns navigation item.
Requests are guarded against stale workspace/view changes. Integration navigation
continues to open each provider directly.

All eight browser workflows passed, including Google builders, Meta-only automatic
routing, switching providers, the correct Create campaign flow, and Viewer access.
Unit suite: 43 passed, 21 opt-in checks skipped. No database or Ads API changes.

## Account access redesign (2026-11-09)

Login and signup use a scoped auth.css with a desktop identity/form split and a
compact mobile identity bar. Form IDs, authentication endpoints and signup rules
are unchanged. Desktop login and mobile signup screenshots were visually checked.
Two new browser cases verify mode switching, signup minimum password length,
password visibility, request payloads and server error presentation at 1440px and
390px. Combined browser suite: 10 passed. Unit suite: 43 passed, 23 opt-in checks
skipped. Ruff lint/format and diff checks passed. No live accounts created by tests.

## Full internal API and browser lifecycle audit (2026-11-13)

An isolated PostgreSQL database was used for the audit. Instrumentation recorded a
successful response for all 42 registered route/method combinations across auth,
workspace membership/invitations, Google and Meta accounts, resources, reporting,
imports, drafts, publication, disconnect and health. The expanded suite passed
59 checks. Its 12 browser checks were skipped in that API-only run.

The full browser run passed 12 checks, including an actual signup → workspace
creation → Google/Meta connection screens → logout → login → refresh → logout
journey against Python/PostgreSQL. The existing Ads browser tests use API fixtures.
A subsequent auth regression run passed four checks, including a delayed workspace
response arriving after logout. Google/Meta HTTP responses in integration tests are
simulated. These results do not establish production OAuth or live ad acceptance.

Fixes include visible retry UI when the initial workspace list fails, invalidating
late workspace loads after logout, clearing workspace privilege/provider UI state
on logout, awaiting workspace initialization, preserving submitted credentials
while boot finishes, auth request timeout and malformed-response errors, and
returning expired application sessions to login after checking /api/me. Provider
401 errors are distinguished by checking whether the application session exists.
CI now runs the real browser lifecycle with its server's exact APP_ORIGIN.

The first actual browser journey was rejected because the audit server origin
did not match the browser port. Matching APP_ORIGIN corrected that test setup.
A relative URL in the browser test's request client was also corrected.
Previously untested endpoint success cases are retained in test_api_lifecycle.py.
