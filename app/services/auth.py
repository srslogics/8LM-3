import asyncio
import secrets

from psycopg.errors import UniqueViolation

from app.core.errors import AppError
from app.core.security import SESSION_MS, digest, new_token, now_ms, password_hash, verify_password
from app.db.database import Database


class AuthService:
    def __init__(self, db: Database):
        self.db = db

    async def session(self, token: str | None):
        if not token:
            return None
        return await self.db.get(
            "SELECT u.id,u.email FROM eightlm.sessions s JOIN eightlm.users u ON u.id=s.user_id WHERE token=%s AND expires>%s",
            digest(token),
            now_ms(),
        )

    async def authenticate(self, action: str, email: str, password: str, old_token: str | None):
        if action not in ("login", "signup"):
            raise AppError("Not found.", 404)
        if action == "signup":
            if len(password) < 12:
                raise AppError("New passwords must contain 12–128 characters.")
            salt = secrets.token_hex(16)
            hashed = await asyncio.to_thread(password_hash, password, salt)
            try:
                user = await self.db.get(
                    "INSERT INTO eightlm.users(email,salt,password_hash) VALUES(%s,%s,%s) RETURNING id,email",
                    email,
                    salt,
                    hashed,
                )
            except UniqueViolation as exc:
                raise AppError(
                    "Unable to create this account. Try signing in instead.", 409
                ) from exc
        else:
            user = await self.db.get("SELECT * FROM eightlm.users WHERE email=%s", email)
            valid = await asyncio.to_thread(
                verify_password,
                password,
                user["salt"] if user else "unregistered-account",
                user["password_hash"] if user else "0" * 128,
            )
            if not user or not valid:
                raise AppError("Email or password is incorrect.", 401)
        token = new_token()
        async with self.db.transaction():
            if old_token:
                await self.db.run("DELETE FROM eightlm.sessions WHERE token=%s", digest(old_token))
            await self.db.run("DELETE FROM eightlm.sessions WHERE expires<=%s", now_ms())
            await self.db.run(
                "INSERT INTO eightlm.sessions(token,user_id,expires) VALUES(%s,%s,%s)",
                digest(token),
                user["id"],
                now_ms() + SESSION_MS,
            )
        return user, token

    async def logout(self, token: str | None):
        if token:
            await self.db.run("DELETE FROM eightlm.sessions WHERE token=%s", digest(token))
