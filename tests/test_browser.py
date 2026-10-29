"""Python browser regression for the preserved nine-step frontend.

API fixtures exercise UI states; real database/Google-boundary tests live separately.
"""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import sync_playwright

pytestmark = pytest.mark.browser


def test_nine_step_builder_and_publication():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        errors, drafts = [], []
        state = {"published": False}
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())

        def api(route):
            path = urlsplit(route.request.url).path
            if path == "/api/me":
                result = {"user": {"email": "owner@example.com"}}
            elif path == "/api/workspaces":
                result = {"workspaces": [{"id": 1, "name": "Studio workspace", "role": "Owner"}]}
            elif path == "/api/workspaces/1":
                result = {
                    "workspace": {"id": 1, "name": "Studio workspace", "role": "Owner"},
                    "members": [{"id": 1, "email": "owner@example.com", "role": "Owner"}],
                    "invites": [],
                    "activity": [],
                }
            elif path.endswith("/ads/accounts"):
                result = {
                    "accounts": [
                        {
                            "id": "1234567890",
                            "name": "Studio Ads",
                            "currency": "INR",
                            "managerId": None,
                        }
                    ],
                    "notices": [],
                }
            elif path.endswith("/ads"):
                result = {
                    "ads": {
                        "customer_id": "1234567890",
                        "account_name": "Studio Ads",
                        "currency_code": "INR",
                        "status": "ACTIVE",
                    },
                    "oauth": {"account_email": "google@example.com"},
                    "oauth_ready": True,
                    "api_configured": True,
                }
            elif path.endswith("/campaigns/drafts"):
                result = {"drafts": drafts}
            elif path.endswith("/ads/campaigns"):
                result = {
                    "campaigns": [
                        {
                            "id": "1234567890:99",
                            "name": "Brand Search",
                            "channel": "SEARCH",
                            "status": "PAUSED",
                            "budget": "INR 100.00/day",
                            "imported": True,
                            "google_resource": "customers/1234567890/campaigns/99",
                        }
                    ]
                    if state["published"]
                    else [],
                    "customer_id": "1234567890",
                    "currency_code": "INR",
                    "metrics": {"impressions": 123, "clicks": 7},
                    "hasDeveloperToken": True,
                }
            elif path.endswith("/campaigns/create"):
                payload = route.request.post_data_json
                for key in ("headlines", "descriptions", "keywords"):
                    payload[key] = payload[key].splitlines()
                drafts.append(
                    {
                        "id": "draft-1",
                        "customer_id": "1234567890",
                        "payload": payload,
                        "state": "DRAFT",
                    }
                )
                result = {"ok": True, "draft": {"id": "draft-1"}}
            elif path.endswith("/publish"):
                state["published"] = True
                drafts[0].update(
                    state="PUBLISHED", resource_name="customers/1234567890/campaigns/99"
                )
                result = {"ok": True, "resource": drafts[0]["resource_name"], "status": "PAUSED"}
            else:
                raise AssertionError(path)
            route.fulfill(content_type="application/json", body=json.dumps(result))

        page.route("**/api/**", api)
        page.goto(os.environ.get("TEST_BASE_URL", "http://localhost:8019"))
        page.locator("#your-role").filter(has_text="Owner").wait_for()
        page.locator("#nav-ads").click()
        page.get_by_text("google@example.com", exact=True).wait_for()
        page.locator("#nav-campaigns").click()
        page.locator("#create-campaign-open-btn").click()
        page.locator("#wizard-pane-1").wait_for(state="visible")
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.locator("#wizard-step-1-next").click()
        assert (
            page.locator('[data-type="Performance Max"]').get_attribute("aria-disabled") == "true"
        )
        page.locator("#wizard-step-2-next").click()
        page.locator("#wizard-campaign-name").fill("Brand Search")
        page.locator("#wizard-step-3-next").click()
        assert page.locator("#wizard-bidding-focus").input_value() == "Manual CPC"
        page.locator("#wizard-step-4-next").click()
        page.locator("#wizard-step-5-next").click()
        page.locator("#rsa-final-url").fill("https://example.com")
        page.locator("#wizard-keywords-input").fill("brand services")
        for i, text in enumerate(
            ["Explore Our Services", "Find Your Solution", "Contact Our Team"]
        ):
            page.locator(".rsa-hl-input").nth(i).fill(text)
        for i, text in enumerate(
            [
                "Find the service you need on our website.",
                "Speak to our team to learn about your options.",
            ]
        ):
            page.locator(".rsa-desc-input").nth(i).fill(text)
        page.locator("#wizard-step-6-next").click()
        page.locator("#wizard-step-7-next").click()
        page.locator("#wizard-budget-input").fill("100")
        page.locator("#wizard-step-8-next").click()
        page.locator("#wizard-adgroup").fill("Brand")
        page.locator("#wizard-max-cpc").fill("5")
        page.locator("#wizard-eu").check()
        page.locator("#wizard-step-9-back").click()
        assert page.locator("#wizard-budget-input").input_value() == "100"
        page.locator("#wizard-step-8-next").click()
        page.locator("#wizard-publish-btn").click()
        page.get_by_role("button", name="Publish paused", exact=True).wait_for()
        assert not state["published"]
        page.get_by_role("button", name="Publish paused", exact=True).click()
        page.get_by_text("Google ID 99", exact=False).wait_for()
        assert state["published"]
        assert page.locator("#kpi-clicks").inner_text() == "7"
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert errors == []
        output = Path(os.environ.get("TEST_ARTIFACTS", "../outputs"))
        output.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(output / "python-dashboard-mobile.png"), full_page=True)
        browser.close()
