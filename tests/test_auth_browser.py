"""Account access layout, mode switching and native form validation."""

import os

import pytest
from playwright.sync_api import sync_playwright

pytestmark = pytest.mark.browser


@pytest.mark.parametrize("width,height", [(1440, 960), (390, 844)])
def test_login_and_signup(width, height):
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": width, "height": height})
        errors, requests = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def api(route):
            if route.request.url.endswith("/api/me"):
                route.fulfill(json={"user": None})
            else:
                requests.append((route.request.url, route.request.post_data_json))
                route.fulfill(status=400, json={"error": "Unable to sign in with these details."})

        page.route("**/api/**", api)
        page.goto(os.environ.get("TEST_BASE_URL", "http://localhost:8021"))
        page.locator("#heading").get_by_text("Log in", exact=True).wait_for()
        assert page.locator("#auth-screen").is_visible()
        assert not page.locator("#app-shell").is_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=f"/tmp/8lm-login-{width}.png", full_page=True)
        page.locator("#switch").click()
        assert page.locator("#heading").inner_text() == "Create an account"
        assert page.locator("#hint").is_visible()
        assert page.locator("#password").get_attribute("autocomplete") == "new-password"
        page.screenshot(path=f"/tmp/8lm-signup-{width}.png", full_page=True)
        page.locator("#email").fill("test@example.test")
        page.locator("#password").fill("short")
        page.locator("#submit").click()
        assert not requests
        page.locator("#password").fill("test-password-123")
        page.locator("#show").click()
        assert page.locator("#password").get_attribute("type") == "text"
        assert page.locator("#show").get_attribute("aria-pressed") == "true"
        page.locator("#show").click()
        assert page.locator("#password").get_attribute("type") == "password"
        page.locator("#submit").click()
        page.locator("#status").get_by_text("Unable to sign in with these details.").wait_for()
        assert requests[0][0].endswith("/api/auth/signup")
        assert requests[0][1] == {"email": "test@example.test", "password": "test-password-123"}
        page.locator("#switch").click()
        assert page.locator("#status").inner_text() == ""
        assert page.locator("#password").get_attribute("autocomplete") == "current-password"
        assert page.locator("#password").get_attribute("minlength") == "1"
        assert not errors, errors
        browser.close()


def test_workspace_failure_is_visible_and_retryable():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page()

        def api(route):
            if route.request.url.endswith("/api/me"):
                route.fulfill(json={"user": {"email": "owner@example.test"}})
            else:
                route.fulfill(status=503, json={"error": "Database temporarily unavailable"})

        page.route("**/api/**", api)
        page.goto(os.environ.get("TEST_BASE_URL", "http://localhost:8021"))
        page.locator("#retry-btn").wait_for()
        assert page.locator("#workspace-title").inner_text() == "Failed to load"
        assert page.locator("#app-shell").is_visible()
        browser.close()


def test_late_workspace_response_after_logout_stays_signed_out():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page()
        pending = []
        attempts = 0

        def api(route):
            nonlocal attempts
            path = route.request.url
            if path.endswith("/api/me"):
                route.fulfill(json={"user": {"email": "owner@example.test"}})
            elif path.endswith("/api/logout"):
                route.fulfill(json={"ok": True})
            elif path.endswith("/api/workspaces"):
                attempts += 1
                if attempts == 1:
                    route.fulfill(status=503, json={"error": "Temporarily unavailable"})
                else:
                    pending.append(route)
            else:
                route.fulfill(status=401, json={"error": "Please log in."})

        page.route("**/api/**", api)
        page.goto(os.environ.get("TEST_BASE_URL", "http://localhost:8021"))
        page.locator("#retry-btn").click()
        page.locator("#nav-signout-btn").click()
        page.locator("#auth-screen").wait_for()
        assert pending
        pending[0].fulfill(json={"workspaces": []})
        page.wait_for_load_state("networkidle")
        assert page.locator("#auth-screen").is_visible()
        assert page.locator("#app-shell").is_hidden()
        assert page.locator("#onboarding-screen").is_hidden()
        browser.close()
