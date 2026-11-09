from typing import Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.dependencies import User, services
from app.api.meta_schemas import MetaAccount, MetaDraft, MetaImport
from app.core.errors import AppError
from app.core.security import COOKIE

router = APIRouter(tags=["Meta Ads"])


@router.get("/api/workspaces/{wid}/auth/meta/url")
async def start(wid: int, request: Request, user: User):
    return {"url": await services(request).meta.begin(wid, user, request.cookies.get(COOKIE, ""))}


@router.get("/api/auth/meta/callback")
async def callback(request: Request, state: str = "", code: str = "", error: str = ""):
    svc = services(request)
    session = request.cookies.get(COOKIE)
    user = await svc.auth.session(session)
    try:
        wid = await svc.meta.callback(user, session, state, code, error)
    except AppError as exc:
        return RedirectResponse("/#meta_error=" + quote(exc.message), status_code=302)
    return RedirectResponse(f"/#meta=success&workspace={wid}", status_code=302)


@router.get("/api/workspaces/{wid}/meta")
async def metadata(wid: int, request: Request, user: User):
    return await services(request).meta.metadata(wid, user)


@router.get("/api/workspaces/{wid}/meta/accounts")
async def accounts(wid: int, request: Request, user: User):
    return {"accounts": await services(request).meta.accounts(wid, user)}


@router.post("/api/workspaces/{wid}/meta/account")
async def select(wid: int, body: MetaAccount, request: Request, user: User):
    await services(request).meta.select(wid, user, body.account_id)
    return {"ok": True}


@router.delete("/api/workspaces/{wid}/meta")
async def disconnect(wid: int, request: Request, user: User):
    await services(request).meta.disconnect(wid, user)
    return {"ok": True}


@router.get("/api/workspaces/{wid}/meta/pixels")
async def pixels(wid: int, request: Request, user: User):
    return {"pixels": await services(request).meta.pixels(wid, user)}


@router.get("/api/workspaces/{wid}/meta/resources")
async def resources(wid: int, request: Request, user: User):
    return await services(request).meta.resources(wid, user)


@router.get("/api/workspaces/{wid}/meta/campaigns")
async def campaigns(
    wid: int,
    request: Request,
    user: User,
    date_preset: Literal["last_7d", "last_30d", "this_month", "last_month"] = "last_30d",
):
    return await services(request).meta.report(wid, user, date_preset)


@router.post("/api/workspaces/{wid}/meta/campaigns/import")
async def track(wid: int, body: MetaImport, request: Request, user: User):
    await services(request).meta.track(wid, user, body.campaign_ids)
    return {"ok": True}


@router.post("/api/workspaces/{wid}/meta/drafts")
async def draft(wid: int, body: MetaDraft, request: Request, user: User):
    return {"draft": await services(request).meta.draft(wid, user, body.payload())}


@router.get("/api/workspaces/{wid}/meta/drafts")
async def drafts(wid: int, request: Request, user: User):
    return {"drafts": await services(request).meta.drafts(wid, user)}


@router.post("/api/workspaces/{wid}/meta/drafts/{key}/publish")
async def publish(wid: int, key: UUID, request: Request, user: User):
    result = await services(request).meta.publish(wid, user, key)
    return JSONResponse(
        result, status_code=200 if result["ok"] else 202 if result.get("pending") else 400
    )
