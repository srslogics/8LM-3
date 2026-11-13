from urllib.parse import parse_qs, urlsplit

import pytest
from test_integration import system as system
from test_meta import meta_system as meta_system
from test_meta import selected

pytestmark = pytest.mark.integration


async def test_workspace_and_google_remaining_routes(system):
    app, (owner, member, outsider), emails, wid, _ = system
    root = f"/api/workspaces/{wid}"

    async def call(method, path, **kwargs):
        r = await owner.request(method, path, **kwargs)
        assert r.status_code == 200, (path, r.status_code, r.text)
        return r.json()

    assert (await call("GET", "/health"))["ok"]
    assert any(w["id"] == wid for w in (await call("GET", "/api/workspaces"))["workspaces"])
    await call("PATCH", root, json={"name": "API audit"})
    assert (await call("GET", root))["workspace"]["name"] == "API audit"
    invitation = await call("POST", root + "/invites", json={"email": emails[1], "role": "Viewer"})
    invite_id = (await call("GET", root))["invites"][0]["id"]
    await call("DELETE", f"{root}/invites/{invite_id}")
    assert (await member.post("/api/workspaces/accept", json=invitation)).status_code == 400
    invitation = await call("POST", root + "/invites", json={"email": emails[1], "role": "Viewer"})
    assert (await member.post("/api/workspaces/accept", json=invitation)).status_code == 200
    member_id = next(
        m["id"] for m in (await call("GET", root))["members"] if m["email"] == emails[1]
    )
    await call("DELETE", f"{root}/members/{member_id}")
    assert (await member.get(root)).status_code == 404
    url = (await call("GET", root + "/auth/google/url"))["url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    callback = await owner.get("/api/auth/google/callback", params={"state": state, "code": "test"})
    assert "oauth=success" in callback.headers["location"]
    await call("POST", root + "/ads/customer-id", json={"customer_id": "1234567890"})
    assert (await call("GET", root + "/ads"))["ads"]["customer_id"] == "1234567890"
    assert (await call("GET", root + "/campaigns/drafts"))["drafts"] == []
    campaigns = root + "/ads/campaigns"
    campaign_id = (await call("GET", campaigns))["campaigns"][0]["id"]
    await call("POST", campaigns + "/import", json={"campaign_ids": [campaign_id]})
    assert (await call("GET", campaigns))["campaigns"][0]["imported"]
    await call("DELETE", root + "/campaigns/" + campaign_id)
    assert not (await call("GET", campaigns))["campaigns"][0]["imported"]


async def test_meta_remaining_routes(meta_system):
    _, (owner, member, outsider), _, wid, _ = meta_system
    await selected(owner, wid)
    root = f"/api/workspaces/{wid}/meta"
    for edge, key in [("/accounts", "accounts"), ("/pixels", "pixels"), ("/resources", "pages")]:
        response = await owner.get(root + edge)
        assert response.status_code == 200, response.text
        assert response.json()[key]
    assert (await owner.delete(root)).status_code == 200
    metadata = (await owner.get(root)).json()
    assert metadata["connection"] is None and metadata["account"] is None


async def test_login_logout_rotation_and_expired_session(system):
    from app.core.security import digest

    app, (owner, _, _), emails, wid, _ = system
    original = owner.cookies.get("8lm_session")
    assert (
        await owner.post("/api/auth/login", json={"email": emails[0], "password": "wrong"})
    ).status_code == 401
    response = await owner.post(
        "/api/auth/login", json={"email": emails[0].upper(), "password": "test-password-123"}
    )
    assert response.status_code == 200
    assert "httponly" in response.headers["set-cookie"].lower()
    assert owner.cookies.get("8lm_session") != original
    assert await app.state.services.auth.session(original) is None
    assert (await owner.post("/api/logout")).status_code == 200
    assert (await owner.get("/api/me")).json()["user"] is None
    assert (await owner.get(f"/api/workspaces/{wid}")).status_code == 401
    assert (
        await owner.post(
            "/api/auth/login", json={"email": emails[0], "password": "test-password-123"}
        )
    ).status_code == 200
    token = owner.cookies.get("8lm_session")
    await app.state.services.db.run(
        "UPDATE eightlm.sessions SET expires=0 WHERE token=%s", digest(token)
    )
    assert (await owner.get("/api/me")).json()["user"] is None
    assert (await owner.get(f"/api/workspaces/{wid}")).status_code == 401
