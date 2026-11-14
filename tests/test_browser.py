"""Python browser regression for the preserved nine-step frontend.

API fixtures exercise UI states; real database/Google-boundary tests live separately.
"""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from desktop_layout import check_desktop_layout
from playwright.sync_api import sync_playwright
from pydantic import TypeAdapter

from app.api.campaign_types import CampaignInput

pytestmark = pytest.mark.browser


@pytest.mark.parametrize(
    "channel", ["Search", "Performance Max", "Demand Gen", "Display", "Shopping"]
)
def test_nine_step_builder_and_publication(channel):
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
            elif path.endswith("/meta"):
                result = {"configured": False, "connection": None, "account": None}
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
            elif path.endswith("/creative-resources/images"):
                result = {
                    "customer_id": "1234567890",
                    "items": [
                        {
                            "resource": f"customers/1234567890/assets/{i}",
                            "name": name,
                            "widthPixels": w,
                            "heightPixels": h,
                        }
                        for i, name, w, h in [
                            (1, "Landscape", 1200, 628),
                            (2, "Square", 1200, 1200),
                            (3, "Logo", 128, 128),
                        ]
                    ],
                }
            elif path.endswith("/creative-resources/audiences"):
                result = {
                    "customer_id": "1234567890",
                    "items": [
                        {"resource": "customers/1234567890/audiences/1", "name": "Customers"}
                    ],
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
                TypeAdapter(CampaignInput).validate_python(payload)
                for key in ("headlines", "descriptions", "keywords"):
                    if key in payload:
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
        if channel == "Search":
            check_desktop_layout(page, "members")
            page.locator("#new-workspace").click()
            check_desktop_layout(page, "workspace-dialog")
            page.locator("#create-ws-cancel").click()
        page.locator("#nav-ads").click()
        page.get_by_text("google@example.com", exact=True).wait_for()
        if channel == "Search":
            for width in (1440, 1024, 820, 768, 390):
                page.set_viewport_size({"width": width, "height": 1000})
                select = page.locator("#google-account-select").bounding_box()
                for button in page.locator("#account-selection-form button").all():
                    rect = button.bounding_box()
                    assert abs(rect["height"] - select["height"]) <= 1
                    if width > 650:
                        assert abs(rect["y"] - select["y"]) <= 1
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.set_viewport_size({"width": 1440, "height": 1000})

        if channel == "Search":
            check_desktop_layout(page, "google-connection")
        page.locator("#nav-campaigns").click()
        check_desktop_layout(page, f"{channel}-campaigns")
        page.locator("#create-campaign-open-btn").click()
        page.locator("#wizard-pane-1").wait_for(state="visible")
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size({"width": 1440, "height": 1000})
        check_desktop_layout(page, f"{channel}-step-1")
        page.locator("#wizard-step-1-next").click()
        assert page.locator('[data-type="Performance Max"]').get_attribute("aria-disabled") is None
        page.locator('[data-type="Video"]').click()
        assert page.locator("#channel-video-note").is_visible()
        page.locator(f'[data-type="{channel}"]').click()
        check_desktop_layout(page, f"{channel}-step-2")
        page.locator("#wizard-step-2-next").click()
        page.locator("#wizard-campaign-name").fill("Brand Search")
        check_desktop_layout(page, f"{channel}-step-3")
        page.locator("#wizard-step-3-next").click()
        assert page.locator("#wizard-bidding-focus").input_value() == {
            "Performance Max": "Maximise conversions",
            "Demand Gen": "Maximise clicks",
        }.get(channel, "Manual CPC")
        check_desktop_layout(page, f"{channel}-step-4")
        page.locator("#wizard-step-4-next").click()
        check_desktop_layout(page, f"{channel}-step-5")
        page.locator("#wizard-step-5-next").click()
        if channel == "Search":
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
        elif channel == "Shopping":
            page.locator("#channel-merchant").fill("123456")
            page.locator("#channel-feed").fill("IN")
            page.locator("#channel-products").check()
        else:
            page.locator("#channel-url").fill("https://example.com")
            page.locator("#channel-business").fill("Studio")
            page.locator("#channel-headlines").fill(
                "Explore Today\nFind Your Solution\nContact Our Team"
            )
            page.locator("#channel-descriptions").fill(
                "Explore our range today.\nContact our team for more information."
            )
            if channel != "Demand Gen":
                page.locator("#channel-long").fill(
                    "Explore our services and find the right option for you"
                )
            if channel == "Performance Max":
                page.locator("#channel-conversions").check()
        check_desktop_layout(page, f"{channel}-step-6")
        page.locator("#wizard-step-6-next").click()
        if channel in ("Performance Max", "Demand Gen", "Display"):
            page.locator("#channel-assets-refresh").click()
            page.get_by_text("Images loaded.", exact=False).wait_for()
            for field, identifier in [
                ("landscape_image", "1"),
                ("square_image", "2"),
                ("logo", "3"),
            ]:
                page.locator("#channel-" + field).select_option(
                    "customers/1234567890/assets/" + identifier
                )
            if channel == "Demand Gen":
                page.locator("#channel-audience").select_option("customers/1234567890/audiences/1")
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size({"width": 1440, "height": 1000})
        if channel == "Performance Max":
            output = Path(os.environ.get("TEST_ARTIFACTS", "../outputs"))
            output.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output / "campaign-assets-desktop.png"), full_page=True)
        check_desktop_layout(page, f"{channel}-step-7")
        page.locator("#wizard-step-7-next").click()
        page.locator("#wizard-budget-input").fill("100")
        check_desktop_layout(page, f"{channel}-step-8")
        page.locator("#wizard-step-8-next").click()
        page.locator("#wizard-adgroup").fill("Brand")
        if channel in ("Search", "Display", "Shopping"):
            page.locator("#wizard-max-cpc").fill("5")
        page.locator("#wizard-eu").check()
        page.locator("#wizard-step-9-back").click()
        assert page.locator("#wizard-budget-input").input_value() == "100"
        page.locator("#wizard-step-8-next").click()
        check_desktop_layout(page, f"{channel}-review")
        page.locator("#wizard-publish-btn").click()
        page.get_by_role("button", name="Publish paused", exact=True).wait_for()
        assert drafts[0]["payload"]["channel"] == channel
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
