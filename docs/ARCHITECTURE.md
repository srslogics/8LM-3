# Architecture

## Design

8LM is a modular monolith: one Python deployment owns the API and serves static browser assets. This matches the project's size and avoids extra infrastructure and distributed transactions.

Dependency direction: **API → application services → database/integration adapters**. The composition root is app.main. HTTP routers validate Pydantic requests, obtain the authenticated user and delegate. Services implement permissions, transactions and workflows. The Google adapter owns transport, pagination, errors and payload construction. HTTPX and database pools open/close in ASGI lifespan, not at import time.

~~~mermaid
flowchart LR
    Browser["Existing HTML/CSS/JS UI"] --> API["FastAPI routers + schemas"]
    API --> Auth["Authentication / workspaces"]
    API --> Ads["Google connection / campaigns"]
    Auth --> DB["Psycopg / Neon PostgreSQL"]
    Ads --> DB
    Ads --> Google["HTTPX / Google OAuth + Ads REST"]
~~~

## Persistence decision

Parameterized SQL and existing migrations are retained instead of introducing an ORM and regenerating the schema. This reduces migration risk, makes Postgres locking explicit and preserves production data. Routers do not issue SQL.

Database.transaction uses a task-local context variable to reuse a transaction through nested service calls. Workspace mutations acquire a row lock before rechecking membership. Token refresh acquires its own row lock. Runtime connections use the pooled URL; migrations use the direct URL and existing advisory lock/ledger.

Pools are bounded (five per worker by default). Google requests have a 25-second timeout. Account trees are discovered sequentially. Some operations hold a workspace lock during Google requests: this favors consistency but can delay concurrent requests for that workspace. A durable worker queue is a future scaling option, not implemented here.

## Authentication compatibility

The cookie remains 8lm_session. Tokens remain random 32-byte hex values; only SHA-256 digests are stored. Existing seven-day sessions remain valid.

Node crypto.scrypt(password, hexSalt, 64) is preserved using Python hashlib.scrypt: N=16384, r=8, p=1, dklen=64, literal UTF-8 hex salt. Verification is constant-time and runs off the event loop. A fixed Node-generated vector tests compatibility.

## Publication state machine

~~~mermaid
stateDiagram-v2
    [*] --> DRAFT: validated local draft
    DRAFT --> SENDING: validate-only passes, intent committed
    SENDING --> PUBLISHED: Google resource confirmed
    SENDING --> UNKNOWN: uncertain response
    SENDING --> DRAFT: explicit Google rejection
    UNKNOWN --> PUBLISHED: marker lookup confirms campaign
    UNKNOWN --> UNKNOWN: lookup inconclusive
~~~

A workspace lock serializes publication with account/permission changes. SENDING commits on an independent connection before the Google mutation, so rollback cannot erase the intent. Retries of SENDING/UNKNOWN reconcile the unique campaign-name marker rather than resend. This prevents automatic duplicate writes; it is not a claim of distributed exactly-once delivery. An unresolved outcome requires inspecting Google Ads. Do not rename the marker before reconciliation.

The atomic Google mutation creates budget, paused Search campaign, location, ad group, keywords and responsive search ad with partialFailure=false. Validate-only precedes creation. Google remains the source of truth for published resources and reports.

## Frontend and scope

The restored nine-step builder remains in public/. JavaScript executes browser interactions; Python replaces the backend. Supported fields produce a validated Search draft; a separate confirmation publishes it paused. Unsupported advanced controls remain disabled. Browser fixtures cover all nine steps; integration tests cover real API/database behavior separately.

No microservices, Redis, ORM, frontend framework or background queue is added. Email verification, recovery, delivery and MFA remain unimplemented. Dependencies are locked in uv.lock; requirements.txt is a hash-pinned production export.
