"""Small parameterized SQL gateway with task-local transaction ownership."""

from contextlib import asynccontextmanager
from contextvars import ContextVar

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings, connection_url


class Database:
    def __init__(self, settings: Settings):
        self.url = connection_url(settings.database_url)
        self.pool = AsyncConnectionPool(
            self.url,
            min_size=1,
            max_size=settings.database_pool_size,
            open=False,
            timeout=15,
            kwargs={
                "autocommit": True,
                "row_factory": dict_row,
                "prepare_threshold": None,
                "connect_timeout": 15,
            },
        )
        self._current: ContextVar[AsyncConnection | None] = ContextVar(
            "database_connection", default=None
        )

    async def open(self):
        await self.pool.open(wait=True, timeout=30)

    async def close(self):
        await self.pool.close()

    @asynccontextmanager
    async def connection(self):
        current = self._current.get()
        if current is not None:
            yield current
        else:
            async with self.pool.connection() as conn:
                yield conn

    @asynccontextmanager
    async def transaction(self):
        if self._current.get() is not None:
            yield
            return
        async with self.pool.connection() as conn:
            async with conn.transaction():
                token = self._current.set(conn)
                try:
                    yield
                finally:
                    self._current.reset(token)

    async def get(self, sql: str, *args):
        async with self.connection() as conn:
            return await (await conn.execute(sql, args)).fetchone()

    async def all(self, sql: str, *args):
        async with self.connection() as conn:
            return await (await conn.execute(sql, args)).fetchall()

    async def run(self, sql: str, *args):
        async with self.connection() as conn:
            return (await conn.execute(sql, args)).rowcount

    async def independent(self, sql: str, *args):
        # A separate connection avoids pool starvation while publishers hold workspace locks.
        async with await AsyncConnection.connect(
            self.url, autocommit=True, connect_timeout=15
        ) as conn:
            await conn.execute(sql, args)
