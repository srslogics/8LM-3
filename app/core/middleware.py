"""ASGI boundary: bounded bodies, same-origin writes and safe response headers."""

import logging
import time
from uuid import uuid4

from starlette.responses import JSONResponse

logger = logging.getLogger("eightlm.requests")


class SecurityMiddleware:
    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id, started = uuid4().hex, time.monotonic()
        scope.setdefault("state", {})["request_id"] = request_id
        headers = dict(scope["headers"])
        is_api = scope["path"].startswith("/api/")
        status = 500

        async def secure_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                extra = [
                    (b"x-request-id", request_id.encode()),
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    (
                        b"content-security-policy",
                        b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
                    ),
                ]
                if is_api:
                    extra.append((b"cache-control", b"no-store"))
                if self.settings.production:
                    extra.append(
                        (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
                    )
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)

        if is_api and scope["method"] not in ("GET", "HEAD", "OPTIONS"):
            origin = headers.get(b"origin", b"").decode()
            if headers.get(b"sec-fetch-site") == b"cross-site" or (
                origin and origin != self.settings.origin
            ):
                return await JSONResponse(
                    {"error": "Please use this application's page to continue."}, 403
                )(scope, receive, secure_send)
            chunks, length = [], 0
            while True:
                part = await receive()
                if part["type"] == "http.disconnect":
                    return
                chunk = part.get("body", b"")
                length += len(chunk)
                if length > 65536:
                    return await JSONResponse({"error": "Request body is too large."}, 413)(
                        scope, receive, secure_send
                    )
                chunks.append(chunk)
                if not part.get("more_body"):
                    break
            body, sent = b"".join(chunks), False
            original_receive = receive

            async def replay():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await original_receive()

            receive = replay
        try:
            await self.app(scope, receive, secure_send)
        finally:
            # Never log query strings (OAuth codes), cookies, bodies or credentials.
            logger.info(
                "request id=%s method=%s status=%s duration_ms=%d",
                request_id,
                scope["method"],
                status,
                (time.monotonic() - started) * 1000,
            )
