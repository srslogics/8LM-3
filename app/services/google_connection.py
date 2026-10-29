import base64
import hashlib
import re
import secrets

from app.core.config import Settings
from app.core.errors import AppError, GoogleError
from app.core.security import digest, new_token, now_ms
from app.db.database import Database
from app.integrations.google_ads import ADS_SCOPE, GoogleAdsClient
from app.services.workspaces import MANAGERS, WorkspaceService


class GoogleConnectionService:
    def __init__(
        self,
        db: Database,
        workspaces: WorkspaceService,
        google: GoogleAdsClient,
        settings: Settings,
    ):
        self.db, self.workspaces, self.google, self.settings = db, workspaces, google, settings

    async def begin(self, wid, user, session_token):
        await self.workspaces.member(wid, user, MANAGERS)
        if not self.settings.oauth_ready:
            raise AppError(
                "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
            )
        state, verifier = new_token(), secrets.token_urlsafe(32)
        await self.db.run("DELETE FROM eightlm.google_oauth_states WHERE expires_at<%s", now_ms())
        await self.db.run(
            "INSERT INTO eightlm.google_oauth_states VALUES(%s,%s,%s,%s,%s,%s)",
            digest(state),
            wid,
            user["id"],
            digest(session_token),
            verifier,
            now_ms() + 600000,
        )
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        return self.google.authorization_url(state, challenge)

    async def callback(self, user, session_token, state, code, error=None):
        if not user or not state or not re.fullmatch(r"[a-f0-9]{64}", state):
            raise AppError("Authorization expired. Reconnect Google.")
        pending = await self.db.get(
            "DELETE FROM eightlm.google_oauth_states WHERE state_hash=%s AND user_id=%s AND session_hash=%s AND expires_at>%s RETURNING *",
            digest(state),
            user["id"],
            digest(session_token or ""),
            now_ms(),
        )
        if not pending:
            raise AppError("Invalid or expired authorization.")
        wid = pending["workspace_id"]
        await self.workspaces.member(wid, user, MANAGERS)
        if error or not code:
            raise AppError("Google authorization was declined.")
        tokens = await self.google.exchange(code, pending["verifier"])
        if (
            not tokens.get("access_token")
            or not tokens.get("refresh_token")
            or ADS_SCOPE not in tokens.get("scope", "").split()
        ):
            raise GoogleError("Grant Google Ads and offline access, then reconnect.")
        profile = await self.google.profile(tokens["access_token"])
        async with self.workspaces.locked(wid, user, MANAGERS):
            await self.db.run(
                """INSERT INTO eightlm.oauth_tokens(workspace_id,provider,account_email,account_id,account_name,access_token,refresh_token,expires_at,connected_at)
                VALUES(%s,'google',%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(workspace_id) DO UPDATE SET
                account_email=EXCLUDED.account_email,account_id=EXCLUDED.account_id,account_name=EXCLUDED.account_name,
                access_token=EXCLUDED.access_token,refresh_token=EXCLUDED.refresh_token,expires_at=EXCLUDED.expires_at,connected_at=EXCLUDED.connected_at""",
                wid,
                profile["email"],
                profile["sub"],
                profile.get("name") or profile["email"],
                tokens["access_token"],
                tokens["refresh_token"],
                now_ms() + int(tokens.get("expires_in", 3600)) * 1000,
                now_ms(),
            )
            await self.db.run("DELETE FROM eightlm.google_ads WHERE workspace_id=%s", wid)
            await self.workspaces.audit(wid, user, "Google connected; account selection required")
        return wid

    async def token(self, wid):
        async with self.db.transaction():
            row = await self.db.get(
                "SELECT * FROM eightlm.oauth_tokens WHERE workspace_id=%s FOR UPDATE", wid
            )
            if (
                not row
                or not row["refresh_token"]
                or (row["access_token"] or "").startswith("demo_")
            ):
                raise GoogleError("Reconnect Google to continue.")
            if row["expires_at"] > now_ms() + 90000:
                return row["access_token"]
            fresh = await self.google.refresh(row["refresh_token"])
            if not fresh.get("access_token"):
                raise GoogleError("Reconnect Google: no access token returned.")
            await self.db.run(
                "UPDATE eightlm.oauth_tokens SET access_token=%s,refresh_token=%s,expires_at=%s WHERE workspace_id=%s",
                fresh["access_token"],
                fresh.get("refresh_token") or row["refresh_token"],
                now_ms() + int(fresh.get("expires_in", 3600)) * 1000,
                wid,
            )
            return fresh["access_token"]

    async def selected(self, wid):
        row = await self.db.get(
            "SELECT * FROM eightlm.google_ads WHERE workspace_id=%s AND status='ACTIVE'", wid
        )
        if not row or not re.fullmatch(r"\d{10}", row["customer_id"]):
            raise AppError("Connect Google and select an advertising account first.")
        return row

    async def metadata(self, wid, user):
        await self.workspaces.member(wid, user)
        configured = bool(self.settings.google_ads_developer_token.get_secret_value())
        return {
            "ads": await self.db.get(
                "SELECT customer_id,account_name,status,currency_code,connected_at,manager_id FROM eightlm.google_ads WHERE workspace_id=%s",
                wid,
            ),
            "oauth": await self.db.get(
                "SELECT account_email,account_name,connected_at FROM eightlm.oauth_tokens WHERE workspace_id=%s",
                wid,
            ),
            "oauth_ready": self.settings.oauth_ready,
            "api_configured": configured,
            "missing_config": [] if configured else ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        }

    async def accounts(self, wid, user):
        async with self.workspaces.locked(wid, user, MANAGERS):
            return await self.google.accounts(await self.token(wid))

    async def select(self, wid, user, customer, manager):
        async with self.workspaces.locked(wid, user, MANAGERS):
            account = await self.google.account(await self.token(wid), customer, manager)
            await self.db.run(
                """INSERT INTO eightlm.google_ads(workspace_id,customer_id,account_name,connected_by,connected_at,status,manager_id,currency_code)
                VALUES(%s,%s,%s,%s,%s,'ACTIVE',%s,%s) ON CONFLICT(workspace_id) DO UPDATE SET
                customer_id=EXCLUDED.customer_id,account_name=EXCLUDED.account_name,connected_by=EXCLUDED.connected_by,
                connected_at=EXCLUDED.connected_at,status='ACTIVE',manager_id=EXCLUDED.manager_id,currency_code=EXCLUDED.currency_code""",
                wid,
                customer,
                account["name"],
                user["id"],
                now_ms(),
                manager,
                account["currency"],
            )
            await self.workspaces.audit(wid, user, "Selected Google Ads account " + customer)
        return account

    async def disconnect(self, wid, user):
        async with self.workspaces.locked(wid, user, MANAGERS):
            await self.db.run("DELETE FROM eightlm.google_ads WHERE workspace_id=%s", wid)
            await self.db.run("DELETE FROM eightlm.oauth_tokens WHERE workspace_id=%s", wid)
            await self.db.run("DELETE FROM eightlm.google_oauth_states WHERE workspace_id=%s", wid)
            await self.workspaces.audit(
                wid, user, "Google disconnected; stored credentials removed"
            )
