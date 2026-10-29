from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.dependencies import services
from app.api.schemas import Credentials
from app.core.security import COOKIE, SESSION_MS

router = APIRouter(tags=["Authentication"])


@router.post("/api/auth/{action}")
async def authenticate(action: str, body: Credentials, request: Request):
    svc = services(request)
    await svc.rate_limit.check(request.client.host if request.client else "unknown")
    user, token = await svc.auth.authenticate(
        action, body.email, body.password, request.cookies.get(COOKIE)
    )
    response = JSONResponse({"user": {"email": user["email"]}})
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=svc.settings.production,
        samesite="lax",
        max_age=SESSION_MS // 1000,
        path="/",
    )
    return response


@router.get("/api/me")
async def me(request: Request):
    user = await services(request).auth.session(request.cookies.get(COOKIE))
    return {"user": {"email": user["email"]} if user else None}


@router.post("/api/logout")
async def logout(request: Request):
    await services(request).auth.logout(request.cookies.get(COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE, path="/")
    return response
