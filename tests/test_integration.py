import asyncio
import json
import re
from contextlib import AsyncExitStack
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest

from app.core.config import Settings
from app.core.security import digest, now_ms
from app.db.migrate import migrate
from app.main import create_app

pytestmark = pytest.mark.integration


class GoogleStub:
    def __init__(self):
        self.mutations = 0
        self.validations = 0
        self.refreshes = 0
        self.mode = "normal"
        self.publications = {}

    async def __call__(self, request):
        path = request.url.path
        if request.url.host == "oauth2.googleapis.com":
            fields = parse_qs(request.content.decode())
            if fields["grant_type"] == ["refresh_token"]:
                self.refreshes += 1
            else:
                assert fields.get("code_verifier")
            return httpx.Response(
                200,
                json={
                    "access_token": "test-access",
                    "refresh_token": "test-refresh",
                    "expires_in": 3600,
                    "scope": "openid email https://www.googleapis.com/auth/adwords",
                },
            )
        if path.endswith("/userinfo"):
            return httpx.Response(
                200,
                json={"sub": "test-google", "email": "google@example.test", "email_verified": True},
            )
        assert request.headers["developer-token"] == "test-developer"
        if path.endswith(":listAccessibleCustomers"):
            return httpx.Response(200, json={"resourceNames": ["customers/1234567890"]})
        body = json.loads(request.content)
        if path.endswith("googleAds:search"):
            query = body["query"]
            if "campaign.name LIKE" in query:
                key = re.search(r"%([a-f0-9-]{36})%", query)[1]
                rows = (
                    [{"campaign": {"resourceName": self.publications[key]}}]
                    if key in self.publications
                    else []
                )
            elif "FROM customer LIMIT" in query:
                rows = [
                    {
                        "customer": {
                            "id": "1234567890",
                            "descriptiveName": "Test Ads",
                            "currencyCode": "INR",
                            "manager": False,
                        }
                    }
                ]
            elif "metrics." in query:
                rows = [
                    {"metrics": {"impressions": "123", "clicks": "7", "costMicros": "25000000"}}
                ]
            else:
                rows = [
                    {
                        "campaign": {
                            "id": "987",
                            "resourceName": "customers/1234567890/campaigns/987",
                            "name": "Existing",
                            "advertisingChannelType": "SEARCH",
                            "status": "PAUSED",
                        },
                        "campaignBudget": {"amountMicros": "50000000"},
                    }
                ]
            return httpx.Response(200, json={"results": rows})
        if path.endswith("googleAds:mutate"):
            assert body["partialFailure"] is False
            if body["validateOnly"]:
                self.validations += 1
                return (
                    httpx.Response(400, json={"error": {"message": "Ad text rejected"}})
                    if self.mode == "reject"
                    else httpx.Response(200, json={})
                )
            self.mutations += 1
            campaign = body["mutateOperations"][1]["campaignOperation"]["create"]
            assert campaign["status"] == "PAUSED"
            key = re.search(r"\[8LM ([a-f0-9-]+)\]", campaign["name"])[1]
            resource = f"customers/1234567890/campaigns/{1000 + self.mutations}"
            self.publications[key] = resource
            if self.mode == "timeout":
                raise httpx.ReadTimeout("Simulated lost response", request=request)
            return httpx.Response(
                200,
                json={"mutateOperationResponses": [{"campaignResult": {"resourceName": resource}}]},
            )
        if path.endswith("campaigns:mutate"):
            assert body["operations"][0]["updateMask"] == "status"
            return httpx.Response(200, json={"results": [{}]})
        raise AssertionError(f"Unexpected Google request: {request.method} {path}")


@pytest.fixture
async def system():
    settings = Settings()
    if not settings.neon_branch or settings.neon_branch == "production":
        pytest.fail("Integration tests require a named non-production NEON_BRANCH.")
    settings = settings.model_copy(
        update={"app_env": "test", "app_origin": "http://test", "google_client_id": "test-client"}
    )
    from pydantic import SecretStr

    settings.google_client_secret = SecretStr("test-secret")
    settings.google_ads_developer_token = SecretStr("test-developer")
    await migrate(settings)
    stub = GoogleStub()
    app = create_app(settings, httpx.MockTransport(stub))
    async with app.router.lifespan_context(app), AsyncExitStack() as stack:
        clients, emails = [], []
        for _index in range(3):
            client = await stack.enter_async_context(
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app, client=(f"test-{uuid4()}", 1000)),
                    base_url="http://test",
                    follow_redirects=False,
                )
            )
            email = f"python-{uuid4()}@example.test"
            response = await client.post(
                "/api/auth/signup", json={"email": email, "password": "test-password-123"}
            )
            assert response.status_code == 200, response.text
            clients.append(client)
            emails.append(email)
        wid = (
            await clients[0].post("/api/workspaces", json={"name": "Python integration"})
        ).json()["id"]
        try:
            yield app, clients, emails, wid, stub
        finally:
            db = app.state.services.db
            await db.run("DELETE FROM eightlm.workspaces WHERE id=%s", wid)
            for email in emails:
                await db.run("DELETE FROM eightlm.users WHERE email=%s", email)


async def test_workspace_access_and_session_compatibility(system):
    app, (owner, member, outsider), emails, wid, stub = system
    prefix = f"/api/workspaces/{wid}"
    assert (await member.get(prefix)).status_code == 404
    invite = (
        await owner.post(prefix + "/invites", json={"email": emails[1], "role": "Viewer"})
    ).json()
    assert (await outsider.post("/api/workspaces/accept", json=invite)).status_code == 400
    accepted = await asyncio.gather(
        *[member.post("/api/workspaces/accept", json=invite) for _ in range(2)]
    )
    assert sorted(r.status_code for r in accepted) == [200, 400]
    assert (await member.patch(prefix, json={"name": "Forbidden"})).status_code == 403
    members = (await owner.get(prefix)).json()["members"]
    mid = next(m["id"] for m in members if m["email"] == emails[1])
    oid = next(m["id"] for m in members if m["email"] == emails[0])
    assert (await owner.patch(f"{prefix}/members/{mid}", json={"role": "Admin"})).status_code == 200
    assert (await member.delete(f"{prefix}/members/{oid}")).status_code == 403
    assert (
        await member.post(prefix + "/invites", json={"email": emails[2], "role": "Admin"})
    ).status_code == 403
    assert (await owner.post(prefix + "/transfer", json={"user": mid})).status_code == 200
    assert (
        await owner.request("DELETE", prefix, json={"name": "Python integration"})
    ).status_code == 403
    assert (await member.request("DELETE", prefix, json={"name": "wrong"})).status_code == 400
    assert (
        await member.request("DELETE", prefix, json={"name": "Python integration"})
    ).status_code == 200
    # A pre-existing Node-style session is accepted by Python.
    db = app.state.services.db
    await db.run(
        "INSERT INTO eightlm.sessions VALUES(%s,%s,%s)",
        digest("legacy-node-cookie"),
        oid,
        now_ms() + 60000,
    )
    owner.cookies.set("8lm_session", "legacy-node-cookie")
    assert (await owner.get("/api/me")).json()["user"]["email"] == emails[0]
    await owner.post("/api/logout")
    assert (await owner.get("/api/me")).json()["user"] is None
    assert (
        await owner.post(
            "/api/auth/login", json={"email": emails[0], "password": "test-password-123"}
        )
    ).status_code == 200


async def test_oauth_and_real_publication_routes(system, campaign_input):
    app, (owner, viewer, outsider), emails, wid, stub = system
    prefix = f"/api/workspaces/{wid}"
    invitation = (
        await owner.post(prefix + "/invites", json={"email": emails[1], "role": "Viewer"})
    ).json()
    await viewer.post("/api/workspaces/accept", json=invitation)
    assert (await viewer.get(prefix + "/auth/google/url")).status_code == 403
    start = (await owner.get(prefix + "/auth/google/url")).json()
    params = parse_qs(urlsplit(start["url"]).query)
    state = params["state"][0]
    assert len(state) == 64 and params["code_challenge_method"] == ["S256"]
    callback = "/api/auth/google/callback?state=" + state + "&code=test"
    assert "oauth_error" in (await viewer.get(callback)).headers["location"]
    assert "oauth=success" in (await owner.get(callback)).headers["location"]
    assert "oauth_error" in (await owner.get(callback)).headers["location"]
    db = app.state.services.db
    exp = (await owner.get(prefix + "/auth/google/url")).json()["url"]
    await db.run("UPDATE eightlm.google_oauth_states SET expires_at=0 WHERE workspace_id=%s", wid)
    assert (
        "oauth_error"
        in (
            await owner.get(
                "/api/auth/google/callback",
                params={"state": parse_qs(urlsplit(exp).query)["state"][0], "code": "test"},
            )
        ).headers["location"]
    )
    await db.run("UPDATE eightlm.oauth_tokens SET expires_at=0 WHERE workspace_id=%s", wid)
    assert (await owner.get(prefix + "/ads/accounts")).json()["accounts"][0]["currency"] == "INR"
    await owner.get(prefix + "/ads/accounts")
    assert stub.refreshes == 1
    assert (
        await owner.post(prefix + "/ads/customer-id", json={"customer_id": "1234567890"})
    ).status_code == 200
    assert (
        await owner.post(
            prefix + "/campaigns/create", json={**campaign_input, "eu_political": True}
        )
    ).status_code == 400
    draft = (await owner.post(prefix + "/campaigns/create", json=campaign_input)).json()["draft"]
    publish = prefix + "/campaigns/" + draft["id"] + "/publish"
    assert (await viewer.post(publish)).status_code == 403
    responses = await asyncio.gather(owner.post(publish), owner.post(publish))
    assert all(r.json()["ok"] for r in responses), [r.text for r in responses]
    assert stub.mutations == 1 and stub.validations == 1
    draft = (await owner.post(prefix + "/campaigns/create", json=campaign_input)).json()["draft"]
    publish = prefix + "/campaigns/" + draft["id"] + "/publish"
    stub.mode = "timeout"
    assert (await owner.post(publish)).status_code == 202
    stub.mode = "normal"
    assert (await owner.post(publish)).json()["ok"]
    assert stub.mutations == 2
    draft = (await owner.post(prefix + "/campaigns/create", json=campaign_input)).json()["draft"]
    stub.mode = "reject"
    assert (await owner.post(prefix + "/campaigns/" + draft["id"] + "/publish")).status_code == 400
    assert stub.mutations == 2
    stub.mode = "normal"
    report = (await owner.get(prefix + "/ads/campaigns")).json()
    assert report["metrics"]["clicks"] == 7 and report["currency_code"] == "INR"
    assert (
        await owner.patch(prefix + "/campaigns/1234567890:987/status", json={"status": "ENABLED"})
    ).status_code == 200
    assert (await owner.delete(prefix + "/ads")).status_code == 200
    assert await db.get("SELECT 1 FROM eightlm.oauth_tokens WHERE workspace_id=%s", wid) is None


async def test_http_security_and_throttling(system):
    app, (owner, _, __), emails, wid, stub = system
    assert (
        await owner.post("/api/logout", headers={"Origin": "https://evil.example"})
    ).status_code == 403
    assert (await owner.post("/api/logout", content=b"x" * 65537)).status_code == 413
    response = await owner.get("/api/me")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-frame-options"] == "DENY"
    assert "x-request-id" in response.headers
    # Use a dedicated key and call the same shared DB-backed service used by the login API.
    from app.core.errors import AppError

    key = str(uuid4())
    for _ in range(20):
        await app.state.services.rate_limit.check(key)
    with pytest.raises(AppError) as exc:
        await app.state.services.rate_limit.check(key)
    assert exc.value.status == 429
    await app.state.services.db.run(
        "DELETE FROM eightlm.auth_rate_limits WHERE key_hash=%s", digest(key)
    )


async def test_sessions_survive_app_restart(system):
    app, (owner, _, __), emails, wid, stub = system
    token = owner.cookies.get("8lm_session")
    # A second independent application instance shares the DB, not in-memory sessions.
    restarted = create_app(app.state.services.settings, httpx.MockTransport(stub))
    async with restarted.router.lifespan_context(restarted):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted),
            base_url="http://test",
            cookies={"8lm_session": token},
        ) as client:
            assert (await client.get("/api/me")).json()["user"]["email"] == emails[0]
            assert (await client.get(f"/api/workspaces/{wid}")).status_code == 200
    before = await app.state.services.db.all("SELECT name FROM eightlm.migrations ORDER BY name")
    await migrate(app.state.services.settings)
    assert before == await app.state.services.db.all(
        "SELECT name FROM eightlm.migrations ORDER BY name"
    )


async def test_callback_rechecks_role_and_browser_session(system):
    app, (owner, _, __), emails, wid, stub = system
    db = app.state.services.db
    user = await db.get("SELECT id FROM eightlm.users WHERE email=%s", emails[0])
    prefix = f"/api/workspaces/{wid}"
    url = (await owner.get(prefix + "/auth/google/url")).json()["url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    token = "other-browser-" + str(uuid4())
    await db.run(
        "INSERT INTO eightlm.sessions VALUES(%s,%s,%s)", digest(token), user["id"], now_ms() + 60000
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        cookies={"8lm_session": token},
    ) as other_browser:
        response = await other_browser.get(
            "/api/auth/google/callback", params={"state": state, "code": "test"}
        )
        assert "oauth_error" in response.headers["location"]
    await db.run(
        "UPDATE eightlm.members SET role='Viewer' WHERE workspace_id=%s AND user_id=%s",
        wid,
        user["id"],
    )
    try:
        response = await owner.get(
            "/api/auth/google/callback", params={"state": state, "code": "test"}
        )
        assert "oauth_error" in response.headers["location"]
        assert await db.get("SELECT 1 FROM eightlm.oauth_tokens WHERE workspace_id=%s", wid) is None
    finally:
        await db.run(
            "UPDATE eightlm.members SET role='Owner' WHERE workspace_id=%s AND user_id=%s",
            wid,
            user["id"],
        )
