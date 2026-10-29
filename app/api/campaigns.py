from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.dependencies import User, services
from app.api.schemas import CampaignImport, CampaignStatus, SearchCampaign

router = APIRouter(prefix="/api/workspaces/{wid}", tags=["Campaigns"])


@router.get("/ads/campaigns")
async def campaigns(wid: int, request: Request, user: User):
    return await services(request).campaigns.list(wid, user)


@router.post("/ads/campaigns/import")
async def track(wid: int, body: CampaignImport, request: Request, user: User):
    await services(request).campaigns.track(wid, user, body.campaign_ids)
    return {"ok": True, "imported_count": len(body.campaign_ids)}


@router.post("/campaigns/create")
async def create(wid: int, body: SearchCampaign, request: Request, user: User):
    draft = await services(request).campaigns.draft(wid, user, body.payload())
    return {"ok": True, "draft": draft}


@router.get("/campaigns/drafts")
async def drafts(wid: int, request: Request, user: User):
    return {"drafts": await services(request).campaigns.drafts(wid, user)}


@router.post("/campaigns/{draft_id}/publish")
async def publish(wid: int, draft_id: UUID, request: Request, user: User):
    result = await services(request).campaigns.publish(wid, user, draft_id)
    return JSONResponse(
        result, status_code=200 if result["ok"] else 202 if result.get("pending") else 400
    )


@router.patch("/campaigns/{campaign_id}/status")
async def status(wid: int, campaign_id: str, body: CampaignStatus, request: Request, user: User):
    await services(request).campaigns.status(wid, user, campaign_id, body.status)
    return {"ok": True, "status": body.status}


@router.delete("/campaigns/{campaign_id}")
async def untrack(wid: int, campaign_id: str, request: Request, user: User):
    await services(request).campaigns.untrack(wid, user, campaign_id)
    return {"ok": True}
