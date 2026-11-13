"""Full browser authentication and workspace journey with the actual Python API."""

import os
from uuid import uuid4

import pytest
from playwright.sync_api import sync_playwright

pytestmark = [pytest.mark.browser, pytest.mark.integration]


def test_real_signup_workspace_login_logout():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(os.environ.get("TEST_BASE_URL", "http://localhost:8021"))
        email = f"journey-{uuid4()}@example.test"
        page.locator("#switch").click()
        page.locator("#email").fill(email)
        page.locator("#password").fill("test-password-123")
        page.locator("#submit").click()
        page.locator("#onboarding-ws-name").fill("Lifecycle workspace")
        page.locator("#onboarding-form-step1 button").click()
        page.locator("#workspace-title").wait_for()
        assert page.locator("#workspace-select").input_value()
        page.locator("#nav-ads").click()
        page.locator("#connection-title").get_by_text("Connect Google Ads", exact=True).wait_for()
        page.locator("#nav-meta").click()
        page.locator("#meta-connection-title").get_by_text("Connect Meta", exact=True).wait_for()
        page.locator("#nav-signout-btn").click()
        page.locator("#auth-screen").wait_for()
        assert (
            page.request.get(
                os.environ.get("TEST_BASE_URL", "http://localhost:8021") + "/api/me"
            ).json()
        )["user"] is None
        page.reload()
        page.locator("#email").fill(email)
        page.locator("#password").fill("test-password-123")
        page.locator("#submit").click()
        page.locator("#workspace-title").wait_for()
        page.reload()
        page.locator("#workspace-title").wait_for()
        page.locator("#nav-signout-btn").click()
        page.locator("#auth-screen").wait_for()
        assert not errors, errors
        browser.close()
