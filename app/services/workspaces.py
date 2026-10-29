from contextlib import asynccontextmanager

from app.core.errors import AppError
from app.core.security import SESSION_MS, digest, new_token, now_ms
from app.db.database import Database

MANAGERS = ("Owner", "Admin")
PUBLISHERS = ("Owner", "Admin", "Publisher")
EDITORS = ("Owner", "Admin", "Publisher", "Editor")


class WorkspaceService:
    def __init__(self, db: Database):
        self.db = db

    async def member(self, workspace_id: int, user: dict, roles=None):
        row = await self.db.get(
            "SELECT w.id,w.name,m.role FROM eightlm.workspaces w JOIN eightlm.members m ON m.workspace_id=w.id WHERE w.id=%s AND m.user_id=%s",
            workspace_id,
            user["id"],
        )
        if not row:
            raise AppError("Workspace not found.", 404)
        if roles and row["role"] not in roles:
            raise AppError("Your workspace role cannot perform this action.", 403)
        return row

    @asynccontextmanager
    async def locked(self, workspace_id: int, user: dict, roles=None):
        async with self.db.transaction():
            await self.db.get(
                "SELECT id FROM eightlm.workspaces WHERE id=%s FOR UPDATE", workspace_id
            )
            yield await self.member(workspace_id, user, roles)

    async def audit(self, workspace_id: int, user: dict, action: str):
        await self.db.run(
            "INSERT INTO eightlm.activity(workspace_id,actor,action,created) VALUES(%s,%s,%s,%s)",
            workspace_id,
            user["email"],
            action,
            now_ms(),
        )

    async def list(self, user):
        return await self.db.all(
            "SELECT w.id,w.name,m.role FROM eightlm.workspaces w JOIN eightlm.members m ON w.id=m.workspace_id WHERE m.user_id=%s ORDER BY w.id",
            user["id"],
        )

    async def create(self, user, name):
        async with self.db.transaction():
            row = await self.db.get(
                "INSERT INTO eightlm.workspaces(name) VALUES(%s) RETURNING id", name
            )
            wid = row["id"]
            await self.db.run("INSERT INTO eightlm.members VALUES(%s,%s,'Owner')", wid, user["id"])
            await self.audit(wid, user, "Workspace created")
        return wid

    async def detail(self, wid, user):
        async with self.locked(wid, user) as workspace:
            return {
                "workspace": workspace,
                "members": await self.db.all(
                    "SELECT u.id,u.email,m.role FROM eightlm.members m JOIN eightlm.users u ON u.id=m.user_id WHERE workspace_id=%s",
                    wid,
                ),
                "invites": await self.db.all(
                    "SELECT id,email,role,expires FROM eightlm.invites WHERE workspace_id=%s AND expires>%s",
                    wid,
                    now_ms(),
                )
                if workspace["role"] in MANAGERS
                else [],
                "activity": await self.db.all(
                    "SELECT actor,action,created FROM eightlm.activity WHERE workspace_id=%s ORDER BY id DESC LIMIT 50",
                    wid,
                ),
            }

    async def rename(self, wid, user, name):
        async with self.locked(wid, user, MANAGERS):
            await self.db.run("UPDATE eightlm.workspaces SET name=%s WHERE id=%s", name, wid)
            await self.audit(wid, user, f"Workspace renamed to {name}")

    async def invite(self, wid, user, email, role):
        async with self.locked(wid, user, MANAGERS) as workspace:
            if role == "Admin" and workspace["role"] != "Owner":
                raise AppError("Only owners can appoint admins.", 403)
            if await self.db.get(
                "SELECT 1 FROM eightlm.members m JOIN eightlm.users u ON m.user_id=u.id WHERE workspace_id=%s AND email=%s",
                wid,
                email,
            ):
                raise AppError("This user is already a member.", 409)
            token = new_token()
            await self.db.run(
                "DELETE FROM eightlm.invites WHERE workspace_id=%s AND email=%s", wid, email
            )
            await self.db.run(
                "INSERT INTO eightlm.invites(workspace_id,email,role,hash,expires) VALUES(%s,%s,%s,%s,%s)",
                wid,
                email,
                role,
                digest(token),
                now_ms() + SESSION_MS,
            )
            await self.audit(wid, user, f"Invited {email} as {role}")
        return token

    async def accept(self, user, token):
        async with self.db.transaction():
            found = await self.db.get(
                "SELECT workspace_id FROM eightlm.invites WHERE hash=%s", digest(token)
            )
            if not found:
                raise AppError("Invitation expired, already used, or addressed to another email.")
            wid = found["workspace_id"]
            await self.db.get("SELECT id FROM eightlm.workspaces WHERE id=%s FOR UPDATE", wid)
            invite = await self.db.get(
                "SELECT * FROM eightlm.invites WHERE hash=%s AND expires>%s FOR UPDATE",
                digest(token),
                now_ms(),
            )
            if not invite or invite["email"] != user["email"]:
                raise AppError("Invitation expired, already used, or addressed to another email.")
            await self.db.run(
                "INSERT INTO eightlm.members VALUES(%s,%s,%s) ON CONFLICT DO NOTHING",
                wid,
                user["id"],
                invite["role"],
            )
            await self.db.run("DELETE FROM eightlm.invites WHERE id=%s", invite["id"])
            await self.audit(wid, user, "Invitation accepted")
        return wid

    async def revoke(self, wid, user, invite_id):
        async with self.locked(wid, user, MANAGERS) as workspace:
            invite = await self.db.get(
                "SELECT * FROM eightlm.invites WHERE id=%s AND workspace_id=%s", invite_id, wid
            )
            if not invite:
                raise AppError("Invitation not found.", 404)
            if invite["role"] == "Admin" and workspace["role"] != "Owner":
                raise AppError("Access denied.", 403)
            await self.db.run("DELETE FROM eightlm.invites WHERE id=%s", invite_id)
            await self.audit(wid, user, f"Invitation revoked for {invite['email']}")

    async def change_member(self, wid, user, target_id, role=None):
        async with self.locked(wid, user, MANAGERS) as workspace:
            target = await self.db.get(
                "SELECT role FROM eightlm.members WHERE workspace_id=%s AND user_id=%s",
                wid,
                target_id,
            )
            if not target:
                raise AppError("Member not found.", 404)
            if target["role"] == "Owner" or (
                workspace["role"] != "Owner" and (target["role"] == "Admin" or role == "Admin")
            ):
                raise AppError("You cannot change this member.", 403)
            if role:
                await self.db.run(
                    "UPDATE eightlm.members SET role=%s WHERE workspace_id=%s AND user_id=%s",
                    role,
                    wid,
                    target_id,
                )
            else:
                await self.db.run(
                    "DELETE FROM eightlm.members WHERE workspace_id=%s AND user_id=%s",
                    wid,
                    target_id,
                )
            await self.audit(wid, user, f"Member {target_id}: {role or 'removed'}")

    async def transfer(self, wid, user, target_id):
        async with self.locked(wid, user, ("Owner",)):
            if target_id == user["id"] or not await self.db.get(
                "SELECT 1 FROM eightlm.members WHERE workspace_id=%s AND user_id=%s", wid, target_id
            ):
                raise AppError("Choose another existing member.")
            await self.db.run(
                "UPDATE eightlm.members SET role='Admin' WHERE workspace_id=%s AND user_id=%s",
                wid,
                user["id"],
            )
            await self.db.run(
                "UPDATE eightlm.members SET role='Owner' WHERE workspace_id=%s AND user_id=%s",
                wid,
                target_id,
            )
            await self.audit(wid, user, f"Ownership transferred to member {target_id}")

    async def delete(self, wid, user, name):
        async with self.locked(wid, user, ("Owner",)) as workspace:
            if workspace["name"] != name:
                raise AppError("Type the workspace name to confirm deletion.")
            await self.db.run("DELETE FROM eightlm.workspaces WHERE id=%s", wid)
