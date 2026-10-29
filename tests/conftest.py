import pytest

from app.api.schemas import SearchCampaign


def pytest_addoption(parser):
    parser.addoption(
        "--integration", action="store_true", help="Run against an isolated PostgreSQL database."
    )
    parser.addoption(
        "--browser", action="store_true", help="Run Chrome checks against TEST_BASE_URL."
    )


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "integration" in item.keywords and not config.getoption("--integration"):
            item.add_marker(
                pytest.mark.skip(reason="Use --integration with an isolated test database.")
            )
        if "browser" in item.keywords and not config.getoption("--browser"):
            item.add_marker(
                pytest.mark.skip(reason="Use --browser with a running local application.")
            )


@pytest.fixture
def campaign_input():
    return dict(
        name="Brand Search",
        ad_group="Primary",
        channel="Search",
        budget="100",
        cpc="5",
        country="India",
        match_type="PHRASE",
        final_url="https://example.com",
        keywords="brand services\nquality services",
        headlines="Explore Our Services\nFind Your Solution\nContact Our Team",
        descriptions="Find the service you need on our website.\nSpeak to our team about your options.",
        eu_political=False,
    )


@pytest.fixture
def payload(campaign_input):
    return SearchCampaign(**campaign_input).payload()
