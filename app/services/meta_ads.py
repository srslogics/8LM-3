"""Workspace-scoped Meta connection, reporting and resumable paused publication."""

import re
from decimal import Decimal
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from psycopg.types.json import Jsonb

from app.core.errors import AppError
from app.core.security import digest, new_token, now_ms
from app.integrations.meta_ads import MetaError, step_payload
from app.services.workspaces import EDITORS, MANAGERS, PUBLISHERS

# Initial publishing is limited to currencies whose API budget unit is explicitly supported.
BUDGET_CURRENCIES = {"INR", "USD", "GBP", "EUR", "AUD", "CAD", "SGD"}


class MetaService:
    def __init__(self, db, workspaces, client, settings):
        self.db, self.workspaces, self.client, self.settings = db, workspaces, client, settings

    def cipher(self):
        try:
            return Fernet(self.settings.meta_token_encryption_key.get_secret_value().encode())
        except (ValueError, TypeError) as exc:
            raise AppError(
                "Meta token encryption is not configured. Ask the administrator to set META_TOKEN_ENCRYPTION_KEY.",
                503,
            ) from exc

    async def begin(self, wid, user, session):
        await self.workspaces.member(wid, user, MANAGERS)
        if not self.settings.meta_ready:
            raise AppError(
                "Meta is not configured yet. Add the Meta app settings in Render first.", 503
            )
        self.cipher()
        state = new_token()
        await self.db.run("DELETE FROM eightlm.meta_oauth_states WHERE expires_at<%s", now_ms())
        await self.db.run(
            "INSERT INTO eightlm.meta_oauth_states VALUES(%s,%s,%s,%s,%s)",
            digest(state),
            wid,
            user["id"],
            digest(session),
            now_ms() + 600000,
        )
        return self.client.authorization_url(state)

    async def callback(self, user, session, state, code, error):
        if not user or not re.fullmatch(r"[a-f0-9]{64}", state):
            raise AppError("Meta authorization expired. Reconnect.")
        pending = await self.db.get(
            "DELETE FROM eightlm.meta_oauth_states WHERE state_hash=%s AND user_id=%s AND session_hash=%s AND expires_at>%s RETURNING workspace_id",
            digest(state),
            user["id"],
            digest(session or ""),
            now_ms(),
        )
        if not pending:
            raise AppError("Invalid Meta authorization session.")
        wid = pending["workspace_id"]
        await self.workspaces.member(wid, user, MANAGERS)
        if error or not code:
            raise AppError("Meta authorization was declined.")
        token, profile, expires = await self.client.exchange(code)
        if expires <= now_ms() + 90000:
            raise AppError("Meta token is already expiring. Reconnect.")
        encrypted = self.cipher().encrypt(token.encode()).decode()
        async with self.workspaces.locked(wid, user, MANAGERS):
            await self.db.run(
                """INSERT INTO eightlm.meta_connections VALUES(%s,%s,%s,%s,%s,%s)
                ON CONFLICT(workspace_id) DO UPDATE SET user_id=EXCLUDED.user_id,account_name=EXCLUDED.account_name,
                token_ciphertext=EXCLUDED.token_ciphertext,expires_at=EXCLUDED.expires_at,connected_at=EXCLUDED.connected_at""",
                wid,
                profile["id"],
                profile.get("name") or "Meta account",
                encrypted,
                expires,
                now_ms(),
            )
            await self.db.run("DELETE FROM eightlm.meta_accounts WHERE workspace_id=%s", wid)
            await self.workspaces.audit(wid, user, "Meta connected; ad account selection required")
        return wid

    async def token(self, wid):
        row = await self.db.get(
            "SELECT token_ciphertext,expires_at FROM eightlm.meta_connections WHERE workspace_id=%s",
            wid,
        )
        if not row or row["expires_at"] <= now_ms() + 90000:
            raise MetaError("Meta connection expired. Reconnect Meta to continue.", 401)
        try:
            return self.cipher().decrypt(row["token_ciphertext"].encode()).decode()
        except InvalidToken as exc:
            raise MetaError(
                "The Meta connection cannot be decrypted. Reconnect using the configured encryption key.",
                401,
            ) from exc

    async def selected(self, wid):
        row = await self.db.get(
            "SELECT account_id,name,currency,timezone_name FROM eightlm.meta_accounts WHERE workspace_id=%s",
            wid,
        )
        if not row:
            raise AppError("Connect Meta and select an advertising account first.")
        return row

    async def metadata(self, wid, user):
        await self.workspaces.member(wid, user)
        return {
            "configured": self.settings.meta_ready,
            "connection": await self.db.get(
                "SELECT account_name,expires_at,connected_at FROM eightlm.meta_connections WHERE workspace_id=%s",
                wid,
            ),
            "account": await self.db.get(
                "SELECT account_id,name,currency,timezone_name FROM eightlm.meta_accounts WHERE workspace_id=%s",
                wid,
            ),
        }

    async def accounts(self, wid, user):
        async with self.workspaces.locked(wid, user, MANAGERS):
            return await self.client.accounts(await self.token(wid))

    async def select(self, wid, user, account):
        async with self.workspaces.locked(wid, user, MANAGERS):
            row = await self.client.account(await self.token(wid), account)
            await self.db.run(
                """INSERT INTO eightlm.meta_accounts VALUES(%s,%s,%s,%s,%s,%s)
                ON CONFLICT(workspace_id) DO UPDATE SET account_id=EXCLUDED.account_id,name=EXCLUDED.name,
                currency=EXCLUDED.currency,timezone_name=EXCLUDED.timezone_name,selected_at=EXCLUDED.selected_at""",
                wid,
                account,
                row.get("name") or account,
                row["currency"],
                row.get("timezone_name", ""),
                now_ms(),
            )
            await self.workspaces.audit(wid, user, "Selected Meta Ads account " + account)

    async def disconnect(self, wid, user):
        async with self.workspaces.locked(wid, user, MANAGERS):
            for table in ("meta_accounts", "meta_connections", "meta_oauth_states"):
                await self.db.run(f"DELETE FROM eightlm.{table} WHERE workspace_id=%s", wid)
            await self.workspaces.audit(wid, user, "Meta disconnected; local credentials removed")

    async def resources(self, wid, user):
        async with self.workspaces.locked(wid, user, EDITORS):
            account, token = await self.selected(wid), await self.token(wid)
            return {
                "account_id": account["account_id"],
                "pages": await self.client.pages(token),
                "images": await self.client.images(token, account["account_id"]),
            }

    async def report(self, wid, user, preset):
        async with self.workspaces.locked(wid, user):
            account, token = await self.selected(wid), await self.token(wid)
            campaigns = await self.client.campaigns(token, account["account_id"])
            notice, metrics = None, None
            try:
                metrics = {
                    r["campaign_id"]: r
                    for r in await self.client.insights(token, account["account_id"], preset)
                }
            except MetaError as exc:
                notice = exc.message
            tracked = {
                r["campaign_id"]
                for r in await self.db.all(
                    "SELECT campaign_id FROM eightlm.meta_tracked_campaigns WHERE workspace_id=%s AND account_id=%s",
                    wid,
                    account["account_id"],
                )
            }
            for row in campaigns:
                row["imported"] = row["id"] in tracked
                row["metrics"] = metrics.get(row["id"], {}) if metrics is not None else None
            return {
                "account": account,
                "campaigns": campaigns,
                "reporting_error": notice,
                "date_preset": preset,
            }

    async def track(self, wid, user, ids):
        async with self.workspaces.locked(wid, user, EDITORS):
            account, token = await self.selected(wid), await self.token(wid)
            actual = {r["id"] for r in await self.client.campaigns(token, account["account_id"])}
            if not set(ids) <= actual:
                raise AppError("Select campaigns that belong to the selected Meta account.")
            await self.db.run(
                "DELETE FROM eightlm.meta_tracked_campaigns WHERE workspace_id=%s AND account_id=%s",
                wid,
                account["account_id"],
            )
            for key in ids:
                await self.db.run(
                    "INSERT INTO eightlm.meta_tracked_campaigns VALUES(%s,%s,%s)",
                    wid,
                    account["account_id"],
                    key,
                )
            await self.workspaces.audit(wid, user, "Updated imported Meta campaigns")

    async def validate_assets(self, wid, account, payload):
        token = await self.token(wid)
        if payload["page_id"] not in {r["id"] for r in await self.client.pages(token)}:
            raise AppError("Choose a Facebook Page you have permission to advertise for.")
        if payload["image_hash"] not in {
            r["hash"] for r in await self.client.images(token, account)
        }:
            raise AppError("Choose an image from the selected Meta ad account.")
        return token

    async def draft(self, wid, user, payload):
        async with self.workspaces.locked(wid, user, EDITORS):
            account = await self.selected(wid)
            if account["currency"] not in BUDGET_CURRENCIES:
                raise AppError(
                    "Publishing currently supports INR, USD, GBP, EUR, AUD, CAD and SGD accounts. Reporting is available for other currencies."
                )
            await self.validate_assets(wid, account["account_id"], payload)
            key = uuid4()
            await self.db.run(
                "INSERT INTO eightlm.meta_publications(id,workspace_id,account_id,currency,payload,created_at) VALUES(%s,%s,%s,%s,%s,%s)",
                key,
                wid,
                account["account_id"],
                account["currency"],
                Jsonb(payload),
                now_ms(),
            )
            return {"id": str(key), "state": "DRAFT"}

    async def drafts(self, wid, user):
        await self.workspaces.member(wid, user)
        return await self.db.all(
            "SELECT id,account_id,currency,payload,state,resources,pending_step,error,created_at FROM eightlm.meta_publications WHERE workspace_id=%s ORDER BY created_at DESC",
            wid,
        )

    async def progress(self, key, state, resources, step=None, error=None):
        # Commit on a separate connection before/after each non-atomic external write.
        await self.db.independent(
            "UPDATE eightlm.meta_publications SET state=%s,resources=%s,pending_step=%s,error=%s WHERE id=%s",
            state,
            Jsonb(resources),
            step,
            error,
            key,
        )

    async def publish(self, wid, user, key):
        async with self.workspaces.locked(wid, user, PUBLISHERS):
            job = await self.db.get(
                "SELECT * FROM eightlm.meta_publications WHERE id=%s AND workspace_id=%s", key, wid
            )
            if not job:
                raise AppError("Meta draft not found.", 404)
            ids = dict(job["resources"])
            if job["state"] == "PUBLISHED":
                return {"ok": True, "resources": ids, "status": "PAUSED"}
            account = await self.selected(wid)
            if account["account_id"] != job["account_id"] or account["currency"] != job["currency"]:
                raise AppError("Select the original Meta account before publishing this draft.")
            token = await self.validate_assets(wid, account["account_id"], job["payload"])
            p = job["payload"]
            budget = int(Decimal(p["daily_budget"]) * 100)
            for step in ("campaign", "adset", "creative", "ad"):
                if step in ids:
                    continue
                label = p[
                    {
                        "campaign": "name",
                        "adset": "adset_name",
                        "creative": "ad_name",
                        "ad": "ad_name",
                    }[step]
                ]
                name = f"{label} [8LM {key} {step}]"
                if job["state"] in ("SENDING", "UNKNOWN") and job["pending_step"] == step:
                    found = await self.client.find_step(
                        token, account["account_id"], step, name, ids
                    )
                    if not found:
                        return {
                            "ok": False,
                            "pending": True,
                            "resources": ids,
                            "error": "Meta has not confirmed the last request. Check Ads Manager, then check status again. No duplicate was sent.",
                        }
                    ids[step] = found
                    await self.progress(key, "DRAFT", ids)
                    continue
                await self.progress(key, "SENDING", ids, step)
                try:
                    ids[step] = await self.client.create(
                        token, account["account_id"], step, step_payload(step, p, name, ids, budget)
                    )
                    await self.progress(key, "DRAFT", ids)
                except Exception as exc:
                    uncertain = not isinstance(exc, MetaError) or exc.uncertain
                    message = (
                        exc.message
                        if isinstance(exc, MetaError)
                        else "Publication was interrupted. Check status before retrying."
                    )
                    await self.progress(
                        key, "UNKNOWN" if uncertain else "FAILED", ids, step, message
                    )
                    return {"ok": False, "pending": uncertain, "resources": ids, "error": message}
            # Final state + tracking + audit commit together. Recorded resource IDs survive rollback.
            await self.db.run(
                "UPDATE eightlm.meta_publications SET state='PUBLISHED',pending_step=NULL,error=NULL WHERE id=%s",
                key,
            )
            await self.db.run(
                "INSERT INTO eightlm.meta_tracked_campaigns VALUES(%s,%s,%s) ON CONFLICT DO NOTHING",
                wid,
                account["account_id"],
                ids["campaign"],
            )
            await self.workspaces.audit(
                wid, user, "Published paused Meta traffic campaign " + ids["campaign"]
            )
            return {"ok": True, "resources": ids, "status": "PAUSED"}
