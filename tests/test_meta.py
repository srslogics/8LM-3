"""Real PostgreSQL + HTTP-boundary tests; no live Meta resources are created."""

import asyncio
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr, ValidationError
from test_integration import system  # noqa: F401, F811

from app.api.meta_schemas import MetaDraft
from app.core.security import now_ms
from app.integrations.meta_ads import MetaAdsClient

DRAFT = dict(
    name="Website traffic",
    adset_name="Visitors",
    ad_name="Image ad",
    daily_budget="150.25",
    country="IN",
    page_id="55",
    image_hash="a" * 32,
    final_url="https://example.com",
    primary_text="Explore our services",
    headline="Our services",
    description="Learn more online",
    no_special_category=True,
)


class MetaStub:
    def __init__(self):
        self.posts = []
        self.rows = {k: [] for k in ("campaigns", "adsets", "adcreatives", "ads")}
        self.mode = "normal"
        self.scopes = [
            "ads_read",
            "ads_management",
            "pages_show_list",
            "pages_read_engagement",
            "pages_manage_ads",
        ]

    async def __call__(self, request):
        path = request.url.path.removeprefix("/v26.0/")
        if path == "oauth/access_token":
            return httpx.Response(200, json={"access_token": "private-meta-token"})
        assert request.headers["authorization"].startswith("Bearer ")
        assert request.url.params.get("appsecret_proof") or b"appsecret_proof=" in request.content
        if path == "debug_token":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "is_valid": True,
                        "app_id": "123",
                        "type": "USER",
                        "user_id": "77",
                        "scopes": self.scopes,
                        "expires_at": now_ms() // 1000 + 86400,
                    }
                },
            )
        if path == "me":
            return httpx.Response(200, json={"id": "77", "name": "Meta user"})
        account = dict(
            id="act_99",
            name="Studio Meta",
            currency="INR",
            account_status=1,
            timezone_name="Asia/Kolkata",
        )
        if path == "me/adaccounts":
            return httpx.Response(200, json={"data": [account]})
        if path in ("act_99", "act_98"):
            return httpx.Response(200, json={**account, "id": path})
        if path == "me/accounts":
            return httpx.Response(
                200, json={"data": [{"id": "55", "name": "Studio Page", "tasks": ["ADVERTISE"]}]}
            )
        if path == "act_99/adimages":
            return httpx.Response(
                200,
                json={"data": [{"hash": "a" * 32, "name": "Hero", "width": 1200, "height": 1200}]},
            )
        if path.endswith("/insights"):
            if self.mode == "report_error":
                return httpx.Response(403, json={"error": {"code": 200}})
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"campaign_id": "1", "spend": "10.50", "impressions": "100", "clicks": "5"}
                    ]
                },
            )
        edge = path.split("/")[-1]
        if edge in self.rows:
            if request.method == "GET":
                return httpx.Response(200, json={"data": self.rows[edge]})
            fields = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            self.posts.append((edge, fields))
            if edge == "adsets" and self.mode == "reject":
                return httpx.Response(400, json={"error": {"code": 100}})
            row = {**fields, "id": str(len(self.posts))}
            self.rows[edge].append(row)
            if edge == "adsets" and self.mode in ("lost", "unknown"):
                if self.mode == "unknown":
                    self.rows[edge].clear()
                raise httpx.ReadTimeout("lost response", request=request)
            return httpx.Response(200, json={"id": row["id"]})
        raise AssertionError(path)


@pytest.fixture
async def meta_system(system):  # noqa: F811
    app, clients, emails, wid, _ = system
    svc = app.state.services.meta
    svc.settings = svc.settings.model_copy(
        update={
            "meta_app_id": "123",
            "meta_app_secret": SecretStr("secret"),
            "meta_login_config_id": "config",
            "meta_token_encryption_key": SecretStr(Fernet.generate_key().decode()),
        }
    )
    stub = MetaStub()
    async with httpx.AsyncClient(transport=httpx.MockTransport(stub)) as http:
        svc.client = MetaAdsClient(svc.settings, http)
        yield app, clients, emails, wid, stub


async def connect(owner, wid):
    root = f"/api/workspaces/{wid}"
    result = await owner.get(root + "/auth/meta/url")
    assert result.status_code == 200, result.text
    state = parse_qs(urlsplit(result.json()["url"]).query)["state"][0]
    callback = f"/api/auth/meta/callback?state={state}&code=authorized"
    response = await owner.get(callback)
    assert "meta=success" in response.headers["location"], response.headers
    return callback


async def selected(owner, wid):
    await connect(owner, wid)
    response = await owner.post(
        f"/api/workspaces/{wid}/meta/account", json={"account_id": "act_99"}
    )
    assert response.status_code == 200, response.text


@pytest.mark.integration
async def test_meta_oauth_encryption_scope_session_and_expiry(meta_system):
    app, (owner, member, _), _, wid, stub = meta_system
    root = f"/api/workspaces/{wid}"
    begin = (await owner.get(root + "/auth/meta/url")).json()["url"]
    state = parse_qs(urlsplit(begin).query)["state"][0]
    callback = f"/api/auth/meta/callback?state={state}&code=x"
    assert "meta_error" in (await member.get(callback)).headers["location"]
    assert "meta=success" in (await owner.get(callback)).headers["location"]
    assert "meta_error" in (await owner.get(callback)).headers["location"]
    db = app.state.services.db
    row = await db.get("SELECT * FROM eightlm.meta_connections WHERE workspace_id=%s", wid)
    assert "private-meta-token" not in str(row)
    metadata = await owner.get(root + "/meta")
    assert "ciphertext" not in metadata.text and "private-meta-token" not in metadata.text
    assert await app.state.services.meta.token(wid) == "private-meta-token"
    stub.scopes = ["ads_read"]
    url = (await owner.get(root + "/auth/meta/url")).json()["url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    assert (
        "meta_error"
        in (await owner.get(f"/api/auth/meta/callback?state={state}&code=x")).headers["location"]
    )
    await db.run("UPDATE eightlm.meta_connections SET expires_at=0 WHERE workspace_id=%s", wid)
    assert (await owner.get(root + "/meta/accounts")).status_code == 401


@pytest.mark.integration
async def test_meta_reporting_import_and_workspace_roles(meta_system):
    app, (owner, viewer, outsider), emails, wid, stub = meta_system
    root = f"/api/workspaces/{wid}"
    await selected(owner, wid)
    stub.rows["campaigns"] = [
        {"id": "1", "name": "Existing", "objective": "OUTCOME_TRAFFIC", "status": "PAUSED"}
    ]
    invite = (
        await owner.post(root + "/invites", json={"email": emails[1], "role": "Viewer"})
    ).json()
    assert (await viewer.post("/api/workspaces/accept", json=invite)).status_code == 200
    assert (await outsider.get(root + "/meta")).status_code == 404
    for path, body in [
        ("/meta/account", {"account_id": "act_99"}),
        ("/meta/drafts", DRAFT),
        ("/meta/campaigns/import", {"campaign_ids": ["1"]}),
    ]:
        assert (await viewer.post(root + path, json=body)).status_code == 403
    assert (await viewer.get(root + "/meta/campaigns")).json()["campaigns"][0]["metrics"][
        "spend"
    ] == "10.50"
    assert (
        await owner.post(root + "/meta/campaigns/import", json={"campaign_ids": ["999"]})
    ).status_code == 400
    assert (
        await owner.post(root + "/meta/campaigns/import", json={"campaign_ids": ["1"]})
    ).status_code == 200
    stub.mode = "report_error"
    report = (await viewer.get(root + "/meta/campaigns")).json()
    assert report["reporting_error"] and report["campaigns"][0]["metrics"] is None
    assert report["campaigns"][0]["imported"]
    members = (await owner.get(root)).json()["members"]
    uid = next(r["id"] for r in members if r["email"] == emails[1])
    await owner.patch(root + f"/members/{uid}", json={"role": "Editor"})
    key = (await viewer.post(root + "/meta/drafts", json=DRAFT)).json()["draft"]["id"]
    assert (await viewer.post(root + f"/meta/drafts/{key}/publish", json={})).status_code == 403
    assert (
        await owner.post(root + "/meta/drafts", json={**DRAFT, "page_id": "999"})
    ).status_code == 400
    assert (
        await owner.post(root + "/meta/drafts", json={**DRAFT, "image_hash": "b" * 32})
    ).status_code == 400
    await owner.post(root + "/meta/account", json={"account_id": "act_98"})
    assert (await owner.post(root + f"/meta/drafts/{key}/publish", json={})).status_code == 400
    assert not stub.posts


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["normal", "reject", "lost", "unknown"])
async def test_meta_publish_resumes_without_duplicate_resources(meta_system, mode):
    _, (owner, _, outsider), _, wid, stub = meta_system
    await selected(owner, wid)
    root = f"/api/workspaces/{wid}/meta"
    key = (await owner.post(root + "/drafts", json=DRAFT)).json()["draft"]["id"]
    path = root + f"/drafts/{key}/publish"
    assert (await outsider.post(path, json={})).status_code == 404
    stub.mode = mode
    first = await owner.post(path, json={})
    assert first.status_code == {"normal": 200, "reject": 400, "lost": 202, "unknown": 202}[mode], (
        first.text
    )
    stub.mode = "normal"
    before = len(stub.posts)
    responses = await asyncio.gather(owner.post(path, json={}), owner.post(path, json={}))
    if mode == "unknown":
        assert all(r.status_code == 202 for r in responses)
        assert len(stub.posts) == before
    else:
        assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
        assert (
            len(stub.rows["campaigns"])
            == len(stub.rows["adsets"])
            == len(stub.rows["ads"])
            == len(stub.rows["adcreatives"])
            == 1
        )
        for edge, body in stub.posts:
            if edge != "adcreatives":
                assert body["status"] == "PAUSED"
            if edge == "adsets":
                assert body["daily_budget"] == "15025"
        published = (await owner.get(root + "/drafts")).json()["drafts"][0]
        assert published["state"] == "PUBLISHED" and len(published["resources"]) == 4


@pytest.mark.parametrize(
    "changes",
    [
        {"no_special_category": False},
        {"daily_budget": "0"},
        {"daily_budget": "1.001"},
        {"final_url": "http://example.com"},
        {"page_id": "../me"},
    ],
)
def test_meta_draft_rejects_unsupported_input(changes):
    with pytest.raises(ValidationError):
        MetaDraft(**{**DRAFT, **changes})


async def test_meta_pagination_stays_on_graph_and_redacts_secrets(caplog):
    import logging
    from types import SimpleNamespace

    from app.integrations.meta_ads import MetaError

    settings = SimpleNamespace(meta_api_version="v26.0", meta_app_secret=SecretStr("secret"))
    calls = []

    def handler(request):
        assert request.url.host == "graph.facebook.com"
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "1"}],
                    "paging": {
                        "next": "https://untrusted.example/steal?token=secret",
                        "cursors": {"after": "next-cursor"},
                    },
                },
            )
        assert request.url.params["after"] == "next-cursor"
        return httpx.Response(200, json={"data": [{"id": "2"}]})

    with caplog.at_level(logging.INFO, logger="httpx"):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            rows = await MetaAdsClient(settings, http).list(
                "me/adaccounts", "sensitive-token", {"input_token": "query-secret"}
            )
    assert rows == [{"id": "1"}, {"id": "2"}]
    assert "query-secret" not in caplog.text and "sensitive-token" not in caplog.text
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(502, json={"error": "malformed sensitive-token"})
        )
    ) as http:
        with pytest.raises(MetaError) as caught:
            await MetaAdsClient(settings, http).request(
                "POST", "act_99/campaigns", "sensitive-token", {}, mutation=True
            )
    assert caught.value.uncertain
    assert "sensitive-token" not in str(caught.value)
