"""Compatibility with Node crypto.scrypt(password, hex_salt, 64)."""

import hashlib
import hmac
import secrets
import time

COOKIE = "8lm_session"
SESSION_MS = 7 * 86400000


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_hex(32)


def password_hash(password: str, salt: str) -> str:
    return hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()


def verify_password(password: str, salt: str, expected: str) -> bool:
    return hmac.compare_digest(password_hash(password, salt), expected)
