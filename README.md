# 8LM

Python application for email/password accounts, workspace access management and Google Ads campaign workflows. The existing nine-step browser interface is preserved.

## Stack and layout

- Backend: Python 3.12+, FastAPI, Uvicorn.
- Persistence: PostgreSQL (Neon), Psycopg 3 async pool.
- Google integration: HTTPX, OAuth with PKCE, Google Ads REST.
- Frontend: HTML, CSS and JavaScript; no Node server or frontend build.
- Quality: pytest, Playwright for Python, Ruff, locked dependencies, GitHub Actions.

~~~text
app/
  main.py                 Application factory and dependency composition
  api/                    HTTP routers, request schemas, authentication dependencies
  core/                   Configuration, security, middleware, errors
  db/                     SQL gateway, transactions, migration runner
  services/               Authentication, workspaces, Google connection, campaigns
  integrations/           Google HTTP boundary and mutation builder
public/                   Existing browser UI and nine-step campaign builder
migrations/               Ordered SQL migrations; existing ledger preserved
tests/                    Unit, Postgres integration and browser tests
docs/                     Architecture, security, deployment and review notes
scripts/start.sh          Migrate, then start Uvicorn
~~~

## Local setup

Install Python 3.13 and [uv](https://docs.astral.sh/uv/getting-started/installation/):

~~~sh
uv sync --frozen --extra dev
cp .env.example .env
# Configure database credentials in .env.
uv run python -m app.db.migrate
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
~~~

Open http://localhost:8000. Environment variables override local files; .env.local overrides .env. Never commit credentials.

Existing neon.ts remains provisioning-only, outside the application runtime. Node is not required to run, migrate, test or deploy Python.

## Verification

~~~sh
uv run --extra dev ruff check app tests
uv run --extra dev ruff format --check app tests
uv run python -m compileall -q app
uv run --extra dev python -m pytest -q
# With a disposable database and NEON_BRANCH set to a non-production name:
uv run --extra dev python -m pytest --integration -q
# With Chrome and the app running at localhost:8019:
TEST_BASE_URL=http://localhost:8019 uv run --extra dev python -m pytest --browser tests/test_browser.py -q
~~~

Integration tests write real database records and clean up their users/workspaces. They simulate Google HTTP responses, not real campaigns. Never run them against production. CI uses a disposable Postgres service.

## Production

Read [deployment instructions](docs/DEPLOYMENT.md) before replacing the Node service. Render needs a Python or Docker runtime and new build/start commands. Repository changes alone do not change the hosting runtime.

- Build: pip install --require-hashes -r requirements.txt
- Start: sh scripts/start.sh
- Health: /health
- Required: DATABASE_URL, DATABASE_URL_UNPOOLED; APP_ENV=production.
- Google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN.
- OAuth callback: https://YOUR_HOST/api/auth/google/callback.

Users, hashes, sessions, memberships, OAuth grants and campaign records stay in the same database. No export/import is required. Migration 010 adds shared login throttling; earlier migration names and ledger remain unchanged.

## Review documents

- [Architecture and design decisions](docs/ARCHITECTURE.md)
- [Security model and limitations](docs/SECURITY.md)
- [Deployment, cutover and rollback](docs/DEPLOYMENT.md)
- [API contract and compatibility](docs/API.md)

The nine-step builder supports Search, standard non-retail Performance Max, Demand Gen image ads, responsive Display ads, and standard Shopping campaigns. Each draft is validated and published paused after confirmation. Image formats reuse assets in the selected Google Ads account; Shopping requires a linked Merchant Center feed. Standard Video opens a Google Ads handoff. See [campaign support and requirements](docs/CAMPAIGN_TYPES.md). Live Google acceptance must be checked with an authorized account after deployment.
