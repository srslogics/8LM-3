"""Draft, publication and reporting application services."""

from uuid import uuid4

from psycopg.types.json import Jsonb

from app.core.errors import AppError, GoogleError
from app.core.security import now_ms
from app.services.workspaces import EDITORS, MANAGERS, PUBLISHERS


class CampaignService:
    def __init__(self, db, workspaces, connection, google):
        self.db, self.workspaces, self.connection, self.google = db, workspaces, connection, google

    async def upsert(self, wid, ads, campaign, imported=False):
        await self.db.run(
            """INSERT INTO eightlm.campaigns
            (id,workspace_id,customer_id,name,channel,status,budget,google_resource,currency_code,publication_state,imported)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,'PUBLISHED',%s)
            ON CONFLICT(workspace_id,id) DO UPDATE SET name=EXCLUDED.name,channel=EXCLUDED.channel,
            status=EXCLUDED.status,budget=EXCLUDED.budget,google_resource=EXCLUDED.google_resource,
            currency_code=EXCLUDED.currency_code,publication_state='PUBLISHED'""",
            ads["customer_id"] + ":" + campaign["id"],
            wid,
            ads["customer_id"],
            campaign["name"],
            campaign["channel"],
            campaign["status"],
            f"{ads['currency_code']} {campaign['budget']:.2f}/day",
            campaign["resource"],
            ads["currency_code"],
            imported,
        )

    async def list(self, wid, user):
        # Hold the workspace lock so an account switch/revocation cannot race the sync.
        async with self.workspaces.locked(wid, user):
            ads = await self.connection.selected(wid)
            notice, metrics = None, None
            try:
                token = await self.connection.token(wid)
                campaigns = await self.google.campaigns(
                    token, ads["customer_id"], ads["manager_id"]
                )
                for campaign in campaigns:
                    await self.upsert(wid, ads, campaign)
                metrics = await self.google.metrics(token, ads["customer_id"], ads["manager_id"])
            except GoogleError as exc:
                notice = exc.message
            rows = await self.db.all(
                "SELECT id,name,channel,status,budget,imported,google_resource,currency_code,publication_state FROM eightlm.campaigns WHERE workspace_id=%s AND customer_id=%s ORDER BY name",
                wid,
                ads["customer_id"],
            )
            return {
                "campaigns": rows,
                "metrics": metrics,
                "apiNotice": notice,
                "customer_id": ads["customer_id"],
                "currency_code": ads["currency_code"],
                "hasDeveloperToken": bool(
                    self.google.settings.google_ads_developer_token.get_secret_value()
                ),
                "accessibleCustomers": [],
            }

    async def track(self, wid, user, ids):
        async with self.workspaces.locked(wid, user, EDITORS):
            ads = await self.connection.selected(wid)
            await self.db.run(
                "UPDATE eightlm.campaigns SET imported=(id=ANY(%s::text[])),imported_at=%s WHERE workspace_id=%s AND customer_id=%s",
                ids,
                now_ms(),
                wid,
                ads["customer_id"],
            )

    async def draft(self, wid, user, payload):
        key = uuid4()
        async with self.workspaces.locked(wid, user, EDITORS):
            ads = await self.connection.selected(wid)
            await self.db.run(
                "INSERT INTO eightlm.campaign_publications(id,workspace_id,customer_id,payload,created_at) VALUES(%s,%s,%s,%s,%s)",
                key,
                wid,
                ads["customer_id"],
                Jsonb(payload),
                now_ms(),
            )
        return {"id": str(key), "state": "DRAFT"}

    async def drafts(self, wid, user):
        await self.workspaces.member(wid, user)
        return await self.db.all(
            "SELECT id,customer_id,payload,state,resource_name,error,created_at FROM eightlm.campaign_publications WHERE workspace_id=%s ORDER BY created_at DESC",
            wid,
        )

    async def record(self, job, resource, ads, user):
        await self.db.run(
            "UPDATE eightlm.campaign_publications SET state='PUBLISHED',resource_name=%s,error=NULL WHERE id=%s",
            resource,
            job["id"],
        )
        await self.upsert(
            job["workspace_id"],
            ads,
            {
                "id": resource.split("/")[-1],
                "name": job["payload"]["name"],
                "channel": "SEARCH",
                "status": "PAUSED",
                "budget": job["payload"]["budget"],
                "resource": resource,
            },
            imported=True,
        )
        await self.workspaces.audit(
            job["workspace_id"], user, "Published paused Search campaign " + resource.split("/")[-1]
        )

    async def publish(self, wid, user, draft_id):
        async with self.workspaces.locked(wid, user, PUBLISHERS):
            job = await self.db.get(
                "SELECT * FROM eightlm.campaign_publications WHERE id=%s AND workspace_id=%s",
                draft_id,
                wid,
            )
            if not job:
                raise AppError("Draft not found.", 404)
            if job["state"] == "PUBLISHED":
                return {"ok": True, "resource": job["resource_name"], "status": "PAUSED"}
            ads = await self.connection.selected(wid)
            if job["customer_id"] != ads["customer_id"]:
                raise AppError("Select the original draft account before publishing.")
            token = await self.connection.token(wid)
            customer, manager, key = ads["customer_id"], ads["manager_id"], str(job["id"])
            if job["state"] in ("SENDING", "UNKNOWN"):
                resource = await self.google.find_publication(token, customer, key, manager)
                if not resource:
                    return {
                        "ok": False,
                        "pending": True,
                        "error": "Publication outcome is not yet confirmed. Check Google Ads, then check status again. No duplicate request was sent.",
                    }
                await self.record(job, resource, ads, user)
                return {"ok": True, "resource": resource, "status": "PAUSED"}
            await self.google.publish(
                token, customer, job["payload"], key, manager, validate_only=True
            )
            # This commit survives outer rollback or a process crash after Google accepts the write.
            await self.db.independent(
                "UPDATE eightlm.campaign_publications SET state='SENDING',error=NULL WHERE id=%s",
                job["id"],
            )
            try:
                response = await self.google.publish(token, customer, job["payload"], key, manager)
                resource = next(
                    (
                        r.get("campaignResult", {}).get("resourceName")
                        for r in response.get("mutateOperationResponses", [])
                        if r.get("campaignResult")
                    ),
                    None,
                )
                if not resource:
                    raise GoogleError(
                        "Google did not return a campaign ID. Check status before retrying.",
                        502,
                        True,
                    )
            except Exception as exc:
                uncertain = not isinstance(exc, GoogleError) or exc.uncertain
                message = (
                    exc.message
                    if isinstance(exc, GoogleError)
                    else "Could not confirm publication. Check status before retrying."
                )
                await self.db.independent(
                    "UPDATE eightlm.campaign_publications SET state=%s,error=%s WHERE id=%s",
                    "UNKNOWN" if uncertain else "DRAFT",
                    message,
                    job["id"],
                )
                return {"ok": False, "error": message, "pending": uncertain}
            await self.record(job, resource, ads, user)
            return {"ok": True, "resource": resource, "status": "PAUSED"}

    async def status(self, wid, user, campaign_id, status):
        async with self.workspaces.locked(wid, user, PUBLISHERS):
            ads = await self.connection.selected(wid)
            campaign = await self.db.get(
                "SELECT google_resource FROM eightlm.campaigns WHERE workspace_id=%s AND id=%s AND customer_id=%s",
                wid,
                campaign_id,
                ads["customer_id"],
            )
            if not campaign or not campaign["google_resource"]:
                raise AppError("Only confirmed Google campaigns can be updated.")
            await self.google.status(
                await self.connection.token(wid),
                ads["customer_id"],
                campaign["google_resource"],
                status,
                ads["manager_id"],
            )
            await self.db.run(
                "UPDATE eightlm.campaigns SET status=%s WHERE workspace_id=%s AND id=%s",
                status,
                wid,
                campaign_id,
            )
            await self.workspaces.audit(wid, user, "Google campaign status changed to " + status)

    async def untrack(self, wid, user, campaign_id):
        async with self.workspaces.locked(wid, user, MANAGERS):
            await self.db.run(
                "UPDATE eightlm.campaigns SET imported=false WHERE workspace_id=%s AND id=%s",
                wid,
                campaign_id,
            )
