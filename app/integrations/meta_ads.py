"""Versioned Meta Graph boundary. Never retry an unconfirmed mutation."""

import hashlib
import hmac
import json
import logging
import re
from urllib.parse import urlencode

import httpx

from app.core.errors import AppError

SCOPES = {
    "ads_read",
    "ads_management",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_ads",
}


class MetaError(AppError):
    def __init__(self, message, status=400, uncertain=False):
        super().__init__(message, status)
        self.uncertain = uncertain


class GraphLogFilter(logging.Filter):
    def filter(self, record):
        # OAuth/debug endpoint query strings contain secrets. Do not log HTTPX's URL.
        if "graph.facebook.com" in record.getMessage():
            record.msg, record.args = "Meta HTTP request (URL redacted)", ()
        return True


logging.getLogger("httpx").addFilter(GraphLogFilter())


class MetaAdsClient:
    def __init__(self, settings, http):
        self.settings, self.http = settings, http
        self.base = f"https://graph.facebook.com/{settings.meta_api_version}"

    def authorization_url(self, state):
        return (
            f"https://www.facebook.com/{self.settings.meta_api_version}/dialog/oauth?"
            + urlencode(
                {
                    "client_id": self.settings.meta_app_id,
                    "redirect_uri": self.settings.origin + "/api/auth/meta/callback",
                    "state": state,
                    "response_type": "code",
                    "config_id": self.settings.meta_login_config_id,
                    "override_default_response_type": "true",
                }
            )
        )

    async def request(self, method, path, token=None, params=None, mutation=False):
        if not re.fullmatch(r"[A-Za-z0-9_/-]+", path):
            raise MetaError("Invalid Meta resource.")
        values = dict(params or {})
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
            values["appsecret_proof"] = hmac.new(
                self.settings.meta_app_secret.get_secret_value().encode(),
                token.encode(),
                hashlib.sha256,
            ).hexdigest()
        values = {
            k: json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list, bool)) else str(v)
            for k, v in values.items()
        }
        try:
            response = await self.http.request(
                method,
                self.base + "/" + path,
                headers=headers,
                **({"params": values} if method == "GET" else {"data": values}),
            )
        except httpx.HTTPError as exc:
            raise MetaError(
                "Meta could not be reached. Check publication status before retrying."
                if mutation
                else "Meta could not be reached. Try again.",
                502,
                mutation,
            ) from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise MetaError("Meta returned an unreadable response.", 502, mutation) from exc
        if not isinstance(data, dict):
            raise MetaError("Meta returned an unexpected response.", 502, mutation)
        if not response.is_success or "error" in data:
            error = data.get("error", {})
            error = error if isinstance(error, dict) else {}
            code = error.get("code") if isinstance(error, dict) else None
            # Do not echo upstream diagnostics; they may contain request parameters or tokens.
            message = {
                190: "Meta authorization expired or was revoked. Reconnect Meta.",
                10: "Meta has not granted the required app permission. Check App Review and asset access.",
                200: "Your Meta account cannot perform this action. Check app permissions and business asset access.",
                100: "Meta rejected a setting or asset. Check the selected Page, image, targeting and budget in Ads Manager.",
                4: "Meta's request limit was reached. Try again later.",
                17: "Meta's request limit was reached. Try again later.",
            }.get(
                code,
                "Meta rejected this request. Check your account status, asset permissions and campaign settings.",
            )
            if code is not None:
                message += f" (Meta code {int(code) if str(code).isdigit() else 'unknown'})"
            raise MetaError(
                message,
                401 if code == 190 else 400,
                mutation and (response.status_code >= 500 or bool(error.get("is_transient"))),
            )
        return data

    async def exchange(self, code):
        common = {
            "client_id": self.settings.meta_app_id,
            "client_secret": self.settings.meta_app_secret.get_secret_value(),
        }
        short = await self.request(
            "GET",
            "oauth/access_token",
            params={
                **common,
                "redirect_uri": self.settings.origin + "/api/auth/meta/callback",
                "code": code,
            },
        )
        if not short.get("access_token"):
            raise MetaError("Meta did not return an access token.")
        long = await self.request(
            "GET",
            "oauth/access_token",
            params={
                **common,
                "grant_type": "fb_exchange_token",
                "fb_exchange_token": short["access_token"],
            },
        )
        token = long.get("access_token")
        if not token:
            raise MetaError("Meta did not return a long-lived token. Reconnect.")
        debug = await self.request(
            "GET",
            "debug_token",
            self.settings.meta_app_id + "|" + self.settings.meta_app_secret.get_secret_value(),
            {"input_token": token},
        )
        info = debug.get("data", {})
        if (
            not info.get("is_valid")
            or str(info.get("app_id")) != self.settings.meta_app_id
            or info.get("type") != "USER"
            or not SCOPES <= set(info.get("scopes", []))
        ):
            raise MetaError(
                "Grant the configured ad account and Page permissions using a User access token configuration, then reconnect."
            )
        profile = await self.request("GET", "me", token, {"fields": "id,name"})
        if not profile.get("id") or str(profile["id"]) != str(info.get("user_id")):
            raise MetaError("Meta account verification failed.")
        # Never assume a token is permanent. Honor both token and data-access expiry.
        deadlines = [
            int(info[k]) * 1000 for k in ("expires_at", "data_access_expires_at") if info.get(k)
        ]
        if not deadlines:
            raise MetaError(
                "Meta did not provide a token expiry. Choose a User access token login configuration."
            )
        return token, profile, min(deadlines)

    async def list(self, path, token, params=None):
        rows, after, seen = [], None, set()
        for _ in range(100):
            data = await self.request(
                "GET",
                path,
                token,
                {**(params or {}), "limit": 100, **({"after": after} if after else {})},
            )
            rows.extend(data.get("data", []))
            paging = data.get("paging", {})
            if not paging.get("next"):
                return rows
            after = paging.get("cursors", {}).get("after")
            if not after or after in seen:
                raise MetaError("Meta pagination could not be completed. Try a smaller date range.")
            seen.add(after)
        raise MetaError(
            "Too many results to load in one request. Narrow the date range in Ads Manager."
        )

    async def accounts(self, token):
        return await self.list(
            "me/adaccounts", token, {"fields": "id,name,currency,account_status,timezone_name"}
        )

    async def account(self, token, account):
        row = await self.request(
            "GET", account, token, {"fields": "id,name,currency,account_status,timezone_name"}
        )
        if row.get("id") != account or row.get("account_status") != 1:
            raise MetaError("Select an active Meta advertising account you can access.")
        return row

    async def pages(self, token):
        rows = await self.list("me/accounts", token, {"fields": "id,name,tasks"})
        return [
            {"id": r["id"], "name": r.get("name", r["id"])}
            for r in rows
            if set(r.get("tasks", [])) & {"ADVERTISE", "MANAGE"}
        ]

    async def images(self, token, account):
        return await self.list(
            account + "/adimages", token, {"fields": "hash,name,url,width,height"}
        )

    async def pixels(self, token, account):
        return await self.list(account + "/adspixels", token, {"fields": "id,name"})

    async def campaigns(self, token, account):
        return await self.list(
            account + "/campaigns", token, {"fields": "id,name,objective,status,effective_status"}
        )

    async def insights(self, token, account, preset):
        return await self.list(
            account + "/insights",
            token,
            {
                "level": "campaign",
                "date_preset": preset,
                "fields": "campaign_id,impressions,clicks,spend,ctr,cpc,actions",
            },
        )

    async def find_step(self, token, account, step, name, resources):
        edge = {"campaign": "campaigns", "adset": "adsets", "creative": "adcreatives", "ad": "ads"}[
            step
        ]
        fields = {
            "campaign": "id,name",
            "adset": "id,name,campaign_id",
            "creative": "id,name",
            "ad": "id,name,adset_id",
        }[step]
        rows = await self.list(account + "/" + edge, token, {"fields": fields})
        rows = [
            r
            for r in rows
            if r.get("name") == name
            and (step != "adset" or r.get("campaign_id") == resources.get("campaign"))
            and (step != "ad" or r.get("adset_id") == resources.get("adset"))
        ]
        if len(rows) > 1:
            raise MetaError(
                "Multiple matching Meta resources found. Review this draft in Ads Manager before proceeding."
            )
        return rows[0]["id"] if rows else None

    async def create(self, token, account, step, body):
        edge = {"campaign": "campaigns", "adset": "adsets", "creative": "adcreatives", "ad": "ads"}[
            step
        ]
        result = await self.request("POST", account + "/" + edge, token, body, mutation=True)
        if not re.fullmatch(r"[0-9]{1,30}", str(result.get("id", ""))):
            raise MetaError(
                "Meta did not confirm the created resource. Check publication status.", 502, True
            )
        return str(result["id"])


def step_payload(step, p, name, ids, budget_minor):
    if step == "campaign":
        return {
            "name": name,
            "objective": p.get("objective", "OUTCOME_TRAFFIC"),
            **(
                {"daily_budget": budget_minor, "bid_strategy": "LOWEST_COST_WITHOUT_CAP"}
                if p.get("budget_scope") == "CAMPAIGN"
                else {}
            ),
            "buying_type": "AUCTION",
            "status": "PAUSED",
            "special_ad_categories": [],
            "is_adset_budget_sharing_enabled": False,
        }
    if step == "adset":
        return {
            "name": name,
            "campaign_id": ids["campaign"],
            "status": "PAUSED",
            **({"daily_budget": budget_minor} if p.get("budget_scope") != "CAMPAIGN" else {}),
            **({k: p[k] for k in ("start_time", "end_time") if p.get(k)}),
            **(
                {
                    "promoted_object": {
                        "pixel_id": p["pixel_id"],
                        "custom_event_type": p.get("conversion_event", "PURCHASE"),
                    }
                }
                if p.get("objective") == "OUTCOME_SALES"
                else {}
            ),
            "billing_event": "IMPRESSIONS",
            "optimization_goal": "OFFSITE_CONVERSIONS"
            if p.get("objective") == "OUTCOME_SALES"
            else "LINK_CLICKS",
            "destination_type": "WEBSITE",
            **(
                {"bid_strategy": "LOWEST_COST_WITHOUT_CAP"}
                if p.get("budget_scope") != "CAMPAIGN"
                else {}
            ),
            "targeting": {
                "geo_locations": {"countries": [p["country"]]},
                "age_min": p.get("age_min", 18),
                "age_max": p.get("age_max", 65),
                "targeting_automation": {"advantage_audience": 0},
                **(
                    {"genders": [1 if p["gender"] == "MEN" else 2]}
                    if p.get("gender", "ALL") != "ALL"
                    else {}
                ),
                "publisher_platforms": ["facebook"],
                "facebook_positions": ["feed"],
                "device_platforms": ["mobile", "desktop"],
            },
        }
    if step == "creative":
        return {
            "name": name,
            "object_story_spec": {
                "page_id": p["page_id"],
                "link_data": {
                    "link": p["final_url"],
                    "image_hash": p["image_hash"],
                    "message": p["primary_text"],
                    "name": p["headline"],
                    "description": p["description"],
                    "call_to_action": {
                        "type": p["call_to_action"],
                        "value": {"link": p["final_url"]},
                    },
                },
            },
        }
    return {
        "name": name,
        "adset_id": ids["adset"],
        "creative": {"creative_id": ids["creative"]},
        "status": "PAUSED",
    }
