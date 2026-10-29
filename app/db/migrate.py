"""Run with python -m app.db.migrate. Reuses the existing migration ledger."""

import asyncio

from psycopg import AsyncConnection

from app.core.config import ROOT, Settings, connection_url


async def migrate(settings: Settings | None = None):
    settings = settings or Settings()
    url = connection_url(settings.database_url_unpooled or settings.database_url)
    async with await AsyncConnection.connect(url, connect_timeout=15) as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(84930271)")
            await conn.execute("CREATE SCHEMA IF NOT EXISTS eightlm")
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS eightlm.migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            for path in sorted((ROOT / "migrations").glob("*.sql")):
                found = await (
                    await conn.execute(
                        "SELECT 1 FROM eightlm.migrations WHERE name=%s", (path.name,)
                    )
                ).fetchone()
                if found:
                    continue
                await conn.execute(path.read_text())
                await conn.execute("INSERT INTO eightlm.migrations(name) VALUES(%s)", (path.name,))
                print("Applied migration:", path.name)
    print("Database migrations complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
