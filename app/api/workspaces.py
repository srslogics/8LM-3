from fastapi import APIRouter, Request

from app.api.dependencies import User, services
from app.api.schemas import AcceptInvite, Invitation, RoleChange, Transfer, WorkspaceName

router = APIRouter(prefix="/api/workspaces", tags=["Workspaces"])


@router.get("")
async def list_workspaces(request: Request, user: User):
    return {"workspaces": await services(request).workspaces.list(user)}


@router.post("")
async def create_workspace(body: WorkspaceName, request: Request, user: User):
    return {"id": await services(request).workspaces.create(user, body.name)}


@router.post("/accept")
async def accept_invitation(body: AcceptInvite, request: Request, user: User):
    return {"id": await services(request).workspaces.accept(user, body.token)}


@router.get("/{wid}")
async def detail(wid: int, request: Request, user: User):
    return await services(request).workspaces.detail(wid, user)


@router.patch("/{wid}")
async def rename(wid: int, body: WorkspaceName, request: Request, user: User):
    await services(request).workspaces.rename(wid, user, body.name)
    return {"ok": True}


@router.delete("/{wid}")
async def delete(wid: int, body: WorkspaceName, request: Request, user: User):
    await services(request).workspaces.delete(wid, user, body.name)
    return {"ok": True}


@router.post("/{wid}/invites")
async def invite(wid: int, body: Invitation, request: Request, user: User):
    return {"token": await services(request).workspaces.invite(wid, user, body.email, body.role)}


@router.delete("/{wid}/invites/{invite_id}")
async def revoke(wid: int, invite_id: int, request: Request, user: User):
    await services(request).workspaces.revoke(wid, user, invite_id)
    return {"ok": True}


@router.patch("/{wid}/members/{target_id}")
async def role(wid: int, target_id: int, body: RoleChange, request: Request, user: User):
    await services(request).workspaces.change_member(wid, user, target_id, body.role)
    return {"ok": True}


@router.delete("/{wid}/members/{target_id}")
async def remove(wid: int, target_id: int, request: Request, user: User):
    await services(request).workspaces.change_member(wid, user, target_id)
    return {"ok": True}


@router.post("/{wid}/transfer")
async def transfer(wid: int, body: Transfer, request: Request, user: User):
    await services(request).workspaces.transfer(wid, user, body.user)
    return {"ok": True}
