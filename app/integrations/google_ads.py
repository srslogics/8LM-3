"""Google REST boundary. No retries for mutations with uncertain outcomes."""

from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlencode

import httpx

from app.core.config import Settings
from app.core.errors import GoogleError

ADS_SCOPE = "https://www.googleapis.com/auth/adwords"


class GoogleAdsClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient):
        self.settings = settings
        self.http = http
        self.base = f"https://googleads.googleapis.com/{settings.google_ads_api_version}"

    def authorization_url(self, state: str, challenge: str) -> str:
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": self.settings.google_client_id,
                "redirect_uri": self.settings.origin + "/api/auth/google/callback",
                "response_type": "code",
                "scope": f"openid email {ADS_SCOPE}",
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )

    async def request(self, method, url, *, mutation=False, **kwargs):
        try:
            response = await self.http.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise GoogleError(
                "Google's response was interrupted. Check publication status before retrying."
                if mutation
                else "Google could not be reached. Try again.",
                502,
                mutation,
            ) from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise GoogleError("Google returned an unreadable response.", 502, mutation) from exc
        if not response.is_success:
            error = data.get("error", {})
            details = error.get("details", []) if isinstance(error, dict) else []
            messages = [
                e.get("message", "") for detail in details for e in detail.get("errors", [])
            ]
            message = (
                " ".join(messages)
                or data.get("error_description")
                or (error.get("message") if isinstance(error, dict) else None)
                or "Google rejected the request. Reconnect if authorization expired."
            )
            raise GoogleError(
                str(message)[:1800],
                401 if response.status_code == 401 else 400,
                mutation and response.status_code >= 500,
            )
        return data

    async def oauth_token(self, **fields):
        return await self.request(
            "POST",
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret.get_secret_value(),
                **fields,
            },
        )

    async def exchange(self, code, verifier):
        return await self.oauth_token(
            code=code,
            code_verifier=verifier,
            redirect_uri=self.settings.origin + "/api/auth/google/callback",
            grant_type="authorization_code",
        )

    async def refresh(self, refresh_token):
        return await self.oauth_token(refresh_token=refresh_token, grant_type="refresh_token")

    async def profile(self, token):
        profile = await self.request(
            "GET",
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {token}"},
        )
        if (
            not profile.get("sub")
            or not profile.get("email")
            or profile.get("email_verified") is not True
        ):
            raise GoogleError("Google did not return a verified account.")
        return profile

    def headers(self, token, manager=None):
        developer = self.settings.google_ads_developer_token.get_secret_value()
        if not developer:
            raise GoogleError("GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.")
        result = {"Authorization": f"Bearer {token}", "developer-token": developer}
        if manager:
            result["login-customer-id"] = manager
        return result

    async def ads(self, token, customer, method, body, manager=None, mutation=False):
        return await self.request(
            "POST",
            f"{self.base}/customers/{customer}/{method}",
            headers=self.headers(token, manager),
            json=body,
            mutation=mutation,
        )

    async def search(self, token, customer, query, manager=None):
        rows, page = [], None
        while True:
            data = await self.ads(
                token,
                customer,
                "googleAds:search",
                {"query": query, **({"pageToken": page} if page else {})},
                manager,
            )
            rows.extend(data.get("results", []))
            page = data.get("nextPageToken")
            if not page:
                return rows

    async def account(self, token, customer, manager=None):
        rows = await self.search(
            token,
            customer,
            "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
            manager,
        )
        account = rows[0].get("customer") if rows else None
        if not account or account.get("manager"):
            raise GoogleError("Select an advertising account, not a manager account.")
        return {
            "id": str(account["id"]),
            "name": account.get("descriptiveName") or str(account["id"]),
            "currency": account.get("currencyCode"),
            "managerId": manager,
        }

    async def accounts(self, token):
        data = await self.request(
            "GET", f"{self.base}/customers:listAccessibleCustomers", headers=self.headers(token)
        )
        accounts, notices = {}, []
        for resource in data.get("resourceNames", []):
            customer = resource.split("/")[-1]
            try:
                rows = await self.search(
                    token,
                    customer,
                    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
                )
                c = rows[0]["customer"] if rows else None
                if not c:
                    continue
                if not c.get("manager"):
                    accounts[str(c["id"])] = {
                        "id": str(c["id"]),
                        "name": c.get("descriptiveName") or str(c["id"]),
                        "currency": c.get("currencyCode"),
                        "managerId": None,
                    }
                else:
                    children = await self.search(
                        token,
                        customer,
                        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE",
                        customer,
                    )
                    for row in children:
                        c = row["customerClient"]
                        key = str(c["id"])
                        accounts.setdefault(
                            key,
                            {
                                "id": key,
                                "name": c.get("descriptiveName") or key,
                                "currency": c.get("currencyCode"),
                                "managerId": customer,
                            },
                        )
            except GoogleError as exc:
                notices.append(f"Account {customer}: {exc.message}")
        return {"accounts": list(accounts.values()), "notices": notices}

    async def campaigns(self, token, customer, manager=None):
        rows = await self.search(
            token,
            customer,
            "SELECT campaign.id, campaign.resource_name, campaign.name, campaign.advertising_channel_type, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id DESC",
            manager,
        )
        return [
            {
                "id": str(r["campaign"]["id"]),
                "resource": r["campaign"]["resourceName"],
                "name": r["campaign"]["name"],
                "channel": r["campaign"]["advertisingChannelType"],
                "status": r["campaign"]["status"],
                "budget": int(r.get("campaignBudget", {}).get("amountMicros", 0)) / 1e6,
            }
            for r in rows
        ]

    async def metrics(self, token, customer, manager=None):
        rows = await self.search(
            token,
            customer,
            "SELECT metrics.impressions, metrics.clicks, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS",
            manager,
        )
        return {
            key: sum(int(row.get("metrics", {}).get(field, 0)) for row in rows) / divisor
            for key, field, divisor in (
                ("impressions", "impressions", 1),
                ("clicks", "clicks", 1),
                ("spend", "costMicros", 1e6),
            )
        }

    async def publish(
        self, token, customer, payload, publication_id, manager=None, validate_only=False
    ):
        return await self.ads(
            token,
            customer,
            "googleAds:mutate",
            {
                "mutateOperations": campaign_operations(customer, payload, publication_id),
                "partialFailure": False,
                "validateOnly": validate_only,
            },
            manager,
            mutation=not validate_only,
        )

    async def find_publication(self, token, customer, publication_id, manager=None):
        rows = await self.search(
            token,
            customer,
            f"SELECT campaign.id, campaign.resource_name FROM campaign WHERE campaign.name LIKE '%{publication_id}%'",
            manager,
        )
        return rows[0]["campaign"]["resourceName"] if rows else None

    async def status(self, token, customer, resource, status, manager=None):
        return await self.ads(
            token,
            customer,
            "campaigns:mutate",
            {
                "operations": [
                    {"update": {"resourceName": resource, "status": status}, "updateMask": "status"}
                ]
            },
            manager,
            mutation=True,
        )


def micros(value):
    return str(
        int((Decimal(str(value)) * 1_000_000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    )


def campaign_operations(customer, payload, publication_id):
    base = f"customers/{customer}"
    budget, campaign, group = (
        f"{base}/campaignBudgets/-1",
        f"{base}/campaigns/-2",
        f"{base}/adGroups/-3",
    )
    return [
        {
            "campaignBudgetOperation": {
                "create": {
                    "resourceName": budget,
                    "name": f"8LM budget {publication_id}",
                    "amountMicros": micros(payload["budget"]),
                    "deliveryMethod": "STANDARD",
                    "explicitlyShared": False,
                }
            }
        },
        {
            "campaignOperation": {
                "create": {
                    "resourceName": campaign,
                    "name": f"{payload['name']} [8LM {publication_id}]",
                    "advertisingChannelType": "SEARCH",
                    "status": "PAUSED",
                    "campaignBudget": budget,
                    "manualCpc": {},
                    "containsEuPoliticalAdvertising": "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
                    "networkSettings": {
                        "targetGoogleSearch": True,
                        "targetSearchNetwork": False,
                        "targetContentNetwork": False,
                        "targetPartnerSearchNetwork": False,
                    },
                    "geoTargetTypeSetting": {"positiveGeoTargetType": "PRESENCE"},
                }
            }
        },
        {
            "campaignCriterionOperation": {
                "create": {
                    "campaign": campaign,
                    "location": {"geoTargetConstant": "geoTargetConstants/" + payload["geo_id"]},
                }
            }
        },
        {
            "adGroupOperation": {
                "create": {
                    "resourceName": group,
                    "name": payload["ad_group"],
                    "campaign": campaign,
                    "type": "SEARCH_STANDARD",
                    "status": "ENABLED",
                    "cpcBidMicros": micros(payload["cpc"]),
                }
            }
        },
        *[
            {
                "adGroupCriterionOperation": {
                    "create": {
                        "adGroup": group,
                        "status": "ENABLED",
                        "keyword": {"text": word, "matchType": payload["match_type"]},
                    }
                }
            }
            for word in payload["keywords"]
        ],
        {
            "adGroupAdOperation": {
                "create": {
                    "adGroup": group,
                    "status": "ENABLED",
                    "ad": {
                        "finalUrls": [payload["final_url"]],
                        "responsiveSearchAd": {
                            "headlines": [{"text": text} for text in payload["headlines"]],
                            "descriptions": [{"text": text} for text in payload["descriptions"]],
                        },
                    },
                }
            }
        },
    ]
