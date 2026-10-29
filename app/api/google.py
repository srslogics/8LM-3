from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.api.dependencies import User, services
from app.api.schemas import AccountSelection
from app.core.errors import AppError
from app.core.security import COOKIE

router = APIRouter(tags=["Google connection"])


@router.get("/api/workspaces/{wid}/auth/google/url")
async def start(wid: int, request: Request, user: User):
    url = await services(request).connection.begin(wid, user, request.cookies.get(COOKIE, ""))
    return {"configured": True, "url": url}


@router.get("/api/auth/google/callback")
async def callback(request: Request, state: str = "", code: str = "", error: str = ""):
    svc = services(request)
    token = request.cookies.get(COOKIE)
    user = await svc.auth.session(token)
    try:
        wid = await svc.connection.callback(user, token, state, code, error)
    except AppError:
        return RedirectResponse(
            "/#oauth_error=" + quote("Google connection failed. Check your access and reconnect."),
            status_code=302,
        )
    return RedirectResponse(f"/#oauth=success&workspace={wid}", status_code=302)


@router.get("/api/workspaces/{wid}/ads")
async def metadata(wid: int, request: Request, user: User):
    return await services(request).connection.metadata(wid, user)


@router.get("/api/workspaces/{wid}/ads/accounts")
async def accounts(wid: int, request: Request, user: User):
    return await services(request).connection.accounts(wid, user)


@router.post("/api/workspaces/{wid}/ads/customer-id")
async def select(wid: int, body: AccountSelection, request: Request, user: User):
    account = await services(request).connection.select(
        wid, user, body.customer_id, body.manager_id
    )
    return {"ok": True, "customer_id": account["id"], "currency_code": account["currency"]}


@router.delete("/api/workspaces/{wid}/ads")
async def disconnect(wid: int, request: Request, user: User):
    await services(request).connection.disconnect(wid, user)
    return {"ok": True}
