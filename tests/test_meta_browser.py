"""Browser acceptance of Meta reporting, review and paused publication."""

import os
import time
from urllib.parse import urlsplit

import pytest
from desktop_layout import check_desktop_layout
from playwright.sync_api import sync_playwright

pytestmark = pytest.mark.browser


@pytest.mark.parametrize(
    "role,objective",
    [("Owner", "OUTCOME_TRAFFIC"), ("Owner", "OUTCOME_SALES"), ("Viewer", "OUTCOME_TRAFFIC")],
)
def test_meta_dashboard_and_builder(role, objective):
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
            elif path.endswith("/ads/campaigns"):
                result = {"campaigns": [], "metrics": {}, "currency_code": "INR"}
            elif path.endswith("/campaigns/drafts"):
                result = {"drafts": []}
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
            elif path.endswith("/meta/accounts"):
                result = {
                    "accounts": [
                        {
                            "id": "act_99",
                            "name": "Studio Meta",
                            "currency": "INR",
                            "account_status": 1,
                        }
                    ]
                }
            elif path.endswith("/meta/pixels"):
                result = {"pixels": [{"id": "66", "name": "Website dataset"}]}
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
        page.locator("#workspace-title").get_by_text("Members & access", exact=True).wait_for()
        if role == "Owner":
            for width in (1440, 1024, 820, 768, 390):
                page.set_viewport_size({"width": width, "height": 1000})
                email = page.locator("#invite-email").bounding_box()
                select = page.locator("#invite-role").bounding_box()
                button = page.locator('#invite-form button[type="submit"]').bounding_box()
                assert abs(select["height"] - button["height"]) <= 1
                if width > 650:
                    assert abs(select["y"] - button["y"]) <= 1
                if width > 900:
                    assert abs(email["y"] - select["y"]) <= 1
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.set_viewport_size({"width": 1440, "height": 1000})
        page.screenshot(path=f"/tmp/8lm-shell-desktop-{role.lower()}.png", full_page=True)
        page.locator("#nav-campaigns").click()
        page.get_by_text("Studio traffic", exact=True).wait_for()
        assert page.locator("#campaign-platform-meta").get_attribute("aria-pressed") == "true"
        assert page.locator("#meta-page-title").inner_text() == "Campaigns · Meta Ads"
        assert page.locator("#create-campaign-open-btn").is_hidden()
        page.locator("#campaign-platform-google").click()
        page.locator("#view-campaigns").wait_for()
        assert page.locator("#view-meta").is_hidden()
        page.locator("#campaign-platform-meta").click()
        page.get_by_text("Studio traffic", exact=True).wait_for()
        for width in (1440, 1024, 820, 768, 390):
            page.set_viewport_size({"width": width, "height": 1000})
            select = page.locator("#meta-range").bounding_box()
            button = page.locator("#meta-refresh").bounding_box()
            assert abs(select["y"] - button["y"]) <= 1
            assert abs(select["height"] - button["height"]) <= 1
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size({"width": 1440, "height": 1000})
        assert "10.50" in page.locator("#meta-kpis").inner_text()
        page.screenshot(path=f"/tmp/8lm-campaigns-platforms-{role.lower()}.png", full_page=True)
        if role == "Owner":
            page.locator("#meta-change").click()
            page.locator("#meta-accounts-status").get_by_text(
                "Choose an active account", exact=False
            ).wait_for()
            for width in (1440, 1024, 820, 768, 390):
                page.set_viewport_size({"width": width, "height": 1000})
                select = page.locator("#meta-account").bounding_box()
                buttons = page.locator("#meta-account-form button")
                for button in buttons.all():
                    assert abs(button.bounding_box()["height"] - select["height"]) <= 1
                if width > 900:
                    assert abs(buttons.first.bounding_box()["y"] - select["y"]) <= 1
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.set_viewport_size({"width": 1440, "height": 1000})
        if role == "Viewer":
            assert page.locator("#meta-connect").is_hidden()
            assert page.locator("#meta-create").is_hidden()
            assert page.locator('#meta-campaigns input[type="checkbox"]').is_disabled()
        else:
            page.locator("#meta-create").click()
            assert page.locator("#me-objective-screen").is_visible()
            page.locator("#me-onboarding-close").click()
            assert page.locator("#meta-builder").is_hidden()
            assert not page.evaluate("document.body.classList.contains('me-is-editing')")
            page.locator("#meta-create").click()
            page.screenshot(path=f"/tmp/meta-objectives-{objective}.png")
            page.locator(f'[data-me-objective="{objective}"]').click()
            page.locator("#me-objective-next").click()
            page.locator("#me-setup-create").click()
            check_desktop_layout(page, f"meta-{objective}-step")
            page.locator("#meta-next").click()
            assert page.locator("#meta-name").is_visible()
            page.locator("#me-validation-list button").first.click()
            assert page.locator("#meta-name").evaluate("el => el === document.activeElement")
            assert page.locator("#me-edit-screen").is_visible()
            assert page.locator("#me-breadcrumb").bounding_box()["y"] >= 0
            assert page.locator(".me-footer").bounding_box()["y"] < 1000
            assert page.locator(".me-hierarchy").is_visible()
            assert page.locator(".me-inspector").is_visible()
            page.screenshot(path=f"/tmp/meta-editor-campaign-{objective}.png")
            page.locator("#meta-name").fill("New traffic campaign")
            page.locator('[name="no_special_category"]').check()
            page.locator("#meta-next").click()
            if objective == "OUTCOME_SALES":
                page.locator("#meta-pixel").select_option("66")
                page.locator("#meta-budget-scope").select_option("CAMPAIGN")
            check_desktop_layout(page, f"meta-{objective}-adset")
            page.screenshot(path=f"/tmp/meta-editor-adset-{objective}.png")
            page.locator("#meta-age-min").fill("60")
            page.locator("#meta-age-max").fill("30")
            assert "Minimum age must not exceed" in page.locator("#me-validation-list").inner_text()
            page.locator("#meta-age-min").fill("18")
            page.locator("#meta-age-max").fill("65")
            page.locator("#meta-budget").fill("150.25")
            page.locator("#meta-next").click()
            check_desktop_layout(page, f"meta-{objective}-creative")
            page.locator("#meta-page").select_option("55")
            page.locator("#meta-image").select_option("a" * 32)
            page.locator("#meta-url").fill("https://example.com")
            page.locator("#meta-primary").fill("Explore our services")
            page.locator("#meta-headline").fill("Our services")
            page.locator("#meta-next").click()
            check_desktop_layout(page, f"meta-{objective}-review")
            assert "150.25 INR" in page.locator("#meta-review").inner_text()
            page.locator("#meta-back").click()
            assert page.locator("#meta-headline").input_value() == "Our services"
            page.locator("#meta-next").click()
            assert (
                "Required fields are complete" in page.locator("#me-validation-list").inner_text()
            )
            page.screenshot(path=f"/tmp/meta-editor-review-{objective}.png")
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert page.locator("#meta-save").is_visible()
            page.screenshot(path=f"/tmp/meta-editor-mobile-{objective}.png")
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.locator("#meta-save").click()
            page.get_by_role("button", name="Publish paused", exact=True).wait_for()
            assert not state["published"]
            page.get_by_role("button", name="Publish paused", exact=True).click()
            page.get_by_role("link", name="Open in Ads Manager ↗").wait_for()
            assert state["published"]
            assert drafts[0]["payload"]["no_special_category"] is True
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not page.locator("#sidebar").is_visible()
        page.locator("#nav-menu-toggle").click()
        assert page.locator("#sidebar").is_visible()
        assert page.locator("#nav-menu-toggle").get_attribute("aria-expanded") == "true"
        page.keyboard.press("Escape")
        assert not page.locator("#sidebar").is_visible()
        page.locator("#nav-menu-toggle").click()
        page.locator("#nav-members").click()
        assert not page.locator("#sidebar").is_visible()
        assert page.locator("#view-members").is_visible()
        page.screenshot(path=f"/tmp/8lm-shell-mobile-{role.lower()}.png", full_page=True)
        page.locator("#nav-menu-toggle").click()
        page.locator("#nav-meta").click()
        page.get_by_text("Studio traffic", exact=True).wait_for()
        page.screenshot(path=f"/tmp/8lm-meta-{role.lower()}.png", full_page=True)
        assert not errors, errors
        assert not unknown, unknown
        browser.close()
