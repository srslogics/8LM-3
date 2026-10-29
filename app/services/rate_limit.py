from app.core.errors import AppError
from app.core.security import digest, now_ms


class AuthRateLimit:
    """Fixed-window throttling shared across application workers via Postgres."""

    def __init__(self, db):
        self.db = db

    async def check(self, address: str):
        now = now_ms()
        window = now - now % 900000
        row = await self.db.get(
            """INSERT INTO eightlm.auth_rate_limits(key_hash,window_start,attempts)
            VALUES(%s,%s,1) ON CONFLICT(key_hash) DO UPDATE SET
            attempts=CASE WHEN eightlm.auth_rate_limits.window_start=EXCLUDED.window_start
                THEN eightlm.auth_rate_limits.attempts+1 ELSE 1 END,
            window_start=EXCLUDED.window_start RETURNING attempts""",
            digest(address),
            window,
        )
        await self.db.run(
            "DELETE FROM eightlm.auth_rate_limits WHERE window_start<%s", window - 900000
        )
        if row["attempts"] > 20:
            raise AppError("Too many attempts. Try again in 15 minutes.", 429)
