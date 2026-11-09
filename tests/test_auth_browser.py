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
