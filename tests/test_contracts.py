import pytest
from pydantic import ValidationError

from app.api.schemas import SearchCampaign
from app.core.config import Settings, connection_url
from app.core.security import password_hash, verify_password
from app.integrations.google_ads import campaign_operations, micros


def test_node_scrypt_compatibility():
    # Fixed vector produced by Node's crypto.scryptSync, not by the Python implementation.
    expected = "6ddc6f13f75066ab1acb8955a0ca641598c41d651038ac21cb29e639fb04192357f652ca51e7f1fb1fcc86bb9d5594d4127cbf0b4cbf8b9f3be344232a6137cd"
    assert password_hash("test-password-123", "00112233445566778899aabbccddeeff") == expected
    assert verify_password("test-password-123", "00112233445566778899aabbccddeeff", expected)
    assert not verify_password("wrong", "00112233445566778899aabbccddeeff", expected)


@pytest.mark.parametrize(
    "field,value",
    [
        ("budget", -1),
        ("cpc", 101),
        ("headlines", "Only one"),
        ("final_url", "javascript:alert(1)"),
        ("eu_political", True),
        ("eu_political", "false"),
        ("country", "Unknown"),
        ("budget", "NaN"),
    ],
)
def test_campaign_rejects_invalid_fields(campaign_input, field, value):
    with pytest.raises(ValidationError):
        SearchCampaign(**{**campaign_input, field: value})


def test_atomic_paused_search_payload(payload):
    operations = campaign_operations("1234567890", payload, "test-id")
    campaign = operations[1]["campaignOperation"]["create"]
    assert campaign["status"] == "PAUSED"
    assert (
        campaign["campaignBudget"]
        == operations[0]["campaignBudgetOperation"]["create"]["resourceName"]
    )
    assert campaign["networkSettings"]["targetContentNetwork"] is False
    assert len([o for o in operations if "adGroupCriterionOperation" in o]) == 2
    assert (
        len(operations[-1]["adGroupAdOperation"]["create"]["ad"]["responsiveSearchAd"]["headlines"])
        == 3
    )
    assert micros("0.1234565") == "123457"


def test_production_origin_and_database_tls():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            database_url="postgresql://localhost/test",
            APP_ENV="production",
            app_origin="http://example.com",
        )
    settings = Settings(
        _env_file=None, database_url="postgresql://u:p@host.neon.tech/db?sslmode=require"
    )
    assert "sslmode=verify-full" in connection_url(settings.database_url)
    assert "sslrootcert=" in connection_url(settings.database_url)
