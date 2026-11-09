"""Browser acceptance of Meta reporting, review and paused publication."""

import os
import time
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import sync_playwright

pytestmark = pytest.mark.browser


@pytest.mark.parametrize("role", ["Owner", "Viewer"])
def test_meta_dashboard_and_builder(role):
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors, drafts, unknown = [], [], []
        state = {"published": False}
        account = {
            "account_id": "act_99",
            "name": "Studio Meta",
            "currency": "INR",
            "timezone_name": "Asia/Kolkata",
        }
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())

        def api(route):
            path = urlsplit(route.request.url).path
            if path == "/api/me":
                result = {"user": {"email": "owner@example.com"}}
            elif path == "/api/workspaces":
                result = {"workspaces": [{"id": 1, "name": "Studio", "role": role}]}
            elif path == "/api/workspaces/1":
                result = {
                    "workspace": {"id": 1, "name": "Studio", "role": role},
                    "members": [{"id": 1, "email": "owner@example.com", "role": role}],
                    "invites": [],
                    "activity": [],
                }
            elif path.endswith("/ads"):
                result = {"ads": None, "oauth": None, "oauth_ready": False, "api_configured": False}
            elif path.endswith("/meta"):
                result = {
                    "configured": True,
                    "connection": {
                        "account_name": "Studio connection",
                        "expires_at": int(time.time() * 1000) + 86400000,
                    },
                    "account": account,
                }
            elif path.endswith("/meta/campaigns"):
                result = {
                    "account": account,
                    "campaigns": [
                        {
                            "id": "1",
                            "name": "Studio traffic",
                            "objective": "OUTCOME_TRAFFIC",
                            "status": "PAUSED",
                            "imported": True,
                            "metrics": {
                                "impressions": "100",
                                "clicks": "5",
                                "spend": "10.50",
                                "ctr": "5",
                                "cpc": "2.10",
                            },
                        }
                    ],
                    "reporting_error": None,
                }
            elif path.endswith("/meta/resources"):
                result = {
                    "account_id": "act_99",
                    "pages": [{"id": "55", "name": "Studio Page"}],
                    "images": [{"hash": "a" * 32, "name": "Hero", "width": 1200, "height": 1200}],
                }
            elif path.endswith("/meta/drafts"):
                if route.request.method == "POST":
                    drafts.append(
                        {
                            "id": "00000000-0000-0000-0000-000000000001",
                            "account_id": "act_99",
                            "currency": "INR",
                            "payload": route.request.post_data_json,
                            "state": "DRAFT",
                            "resources": {},
                            "error": None,
                        }
                    )
                    result = {"draft": {"id": drafts[0]["id"], "state": "DRAFT"}}
                else:
                    result = {"drafts": drafts}
            elif path.endswith("/publish"):
                state["published"] = True
                drafts[0].update(state="PUBLISHED", resources={"campaign": "123"})
                result = {"ok": True, "status": "PAUSED", "resources": {"campaign": "123"}}
            else:
                unknown.append(path)
                result = {}
            route.fulfill(status=200, json=result)

        page.route("**/api/**", api)
        page.goto(os.environ.get("TEST_BASE_URL", "http://localhost:8021"))
        page.locator("#nav-meta").click()
        page.get_by_text("Studio traffic", exact=True).wait_for()
        assert "10.50" in page.locator("#meta-kpis").inner_text()
        if role == "Viewer":
            assert page.locator("#meta-connect").is_hidden()
            assert page.locator("#meta-create").is_hidden()
            assert page.locator('#meta-campaigns input[type="checkbox"]').is_disabled()
        else:
            page.locator("#meta-create").click()
            page.locator("#meta-next").click()
            assert page.locator("#meta-name").is_visible()
            page.locator("#meta-name").fill("New traffic campaign")
            page.locator('[name="no_special_category"]').check()
            page.locator("#meta-next").click()
            page.locator("#meta-budget").fill("150.25")
            page.locator("#meta-next").click()
            page.locator("#meta-page").select_option("55")
            page.locator("#meta-image").select_option("a" * 32)
            page.locator("#meta-url").fill("https://example.com")
            page.locator("#meta-primary").fill("Explore our services")
            page.locator("#meta-headline").fill("Our services")
            page.locator("#meta-next").click()
            assert "150.25 INR" in page.locator("#meta-review").inner_text()
            page.locator("#meta-back").click()
            assert page.locator("#meta-headline").input_value() == "Our services"
            page.locator("#meta-next").click()
            page.locator("#meta-save").click()
            page.get_by_role("button", name="Publish paused", exact=True).wait_for()
            assert not state["published"]
            page.get_by_role("button", name="Publish paused", exact=True).click()
            page.get_by_role("link", name="Open in Ads Manager ↗").wait_for()
            assert state["published"]
            assert drafts[0]["payload"]["no_special_category"] is True
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=f"/tmp/8lm-meta-{role.lower()}.png", full_page=True)
        assert not errors, errors
        assert not unknown, unknown
        browser.close()
