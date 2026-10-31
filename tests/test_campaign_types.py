"""Contract and atomic request regressions for each supported Google Ads format."""

import httpx
import pytest
from pydantic import TypeAdapter, ValidationError

from app.api.campaign_types import CampaignInput
from app.core.config import Settings
from app.core.errors import AppError, GoogleError
from app.integrations.campaign_builders import CHANNELS, check_resource_accounts
from app.integrations.google_ads import GoogleAdsClient, campaign_operations


def campaign_data(channel):
    p = dict(
        name="New campaign",
        ad_group="Primary",
        channel=channel,
        budget="100",
        country="India",
        eu_political=False,
    )
    if channel == "Shopping":
        return {
            **p,
            "cpc": "5",
            "merchant_id": "123456",
            "feed_label": "IN",
            "campaign_priority": 0,
            "all_products_confirmed": True,
        }
    p.update(
        final_url="https://example.com",
        business_name="Studio",
        headlines="Explore Today\nFind Your Solution\nContact Our Team",
        descriptions="Explore our services today.\nContact our team to learn more.",
        landscape_image="customers/1234567890/assets/1",
        square_image="customers/1234567890/assets/2",
        logo="customers/1234567890/assets/3",
    )
    if channel == "Demand Gen":
        p["audience"] = "customers/1234567890/audiences/1"
    else:
        p["long_headline"] = "Explore our services and find the right option for you"
    if channel == "Display":
        p["cpc"] = "5"
    if channel == "Performance Max":
        p["conversions_ready"] = True
    return p


@pytest.mark.parametrize("channel", ["Performance Max", "Demand Gen", "Display", "Shopping"])
def test_complete_atomic_campaign(channel):
    p = TypeAdapter(CampaignInput).validate_python(campaign_data(channel)).payload()
    ops = campaign_operations("1234567890", p, "unique-publication")
    c = ops[1]["campaignOperation"]["create"]
    assert c["advertisingChannelType"] == CHANNELS[channel]
    assert c["status"] == "PAUSED" and "unique-publication" in c["name"]
    # Every temporary reference points to an entity created earlier in this same request.
    created = set()

    def references(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key != "resourceName":
                    yield from references(item)
        elif isinstance(value, list):
            for item in value:
                yield from references(item)
        elif isinstance(value, str) and "/-" in value:
            yield value

    for op in ops:
        fields = next(iter(op.values()))["create"]
        assert set(references(fields)) <= created
        if "resourceName" in fields:
            assert fields["resourceName"] not in created
            created.add(fields["resourceName"])
    if channel == "Performance Max":
        assert c["brandGuidelinesEnabled"]
        assert c["assetAutomationSettings"] == [
            {
                "assetAutomationType": "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION",
                "assetAutomationStatus": "OPTED_OUT",
            }
        ]
        assert c["maximizeConversions"] == {}
        brands = [
            o["campaignAssetOperation"]["create"]["fieldType"]
            for o in ops
            if "campaignAssetOperation" in o
        ]
        assert set(brands) == {"BUSINESS_NAME", "LOGO"}
        assert not any("adGroupOperation" in o for o in ops)
    elif channel == "Shopping":
        assert c["shoppingSetting"]["feedLabel"] == "IN"
        assert ops[-1]["adGroupAdOperation"]["create"]["ad"] == {"shoppingProductAd": {}}
        assert ops[-2]["adGroupCriterionOperation"]["create"]["listingGroup"] == {"type": "UNIT"}
    elif channel == "Demand Gen":
        assert c["demandGenCampaignSettings"]["upgradedTargeting"] is False
        assert "targetSpend" in c and "manualCpc" not in c
        assert (
            ops[-2]["adGroupCriterionOperation"]["create"]["audience"]["audience"] == p["audience"]
        )
        assert "demandGenMultiAssetAd" in ops[-1]["adGroupAdOperation"]["create"]["ad"]
    else:
        assert "responsiveDisplayAd" in ops[-1]["adGroupAdOperation"]["create"]["ad"]


@pytest.mark.parametrize(
    "channel,field,value",
    [
        ("Performance Max", "conversions_ready", False),
        (
            "Performance Max",
            "headlines",
            "A headline longer than fifteen\nAnother headline over fifteen\nThird headline over fifteen",
        ),
        ("Display", "cpc", "101"),
        ("Display", "landscape_image", "customers/1234567890/assets/1' OR 1=1"),
        ("Demand Gen", "audience", ""),
        ("Shopping", "all_products_confirmed", False),
        ("Shopping", "merchant_id", "not-an-id"),
        ("Shopping", "feed_label", ""),
        ("Shopping", "campaign_priority", 3),
        ("Display", "final_url", "https://user:pass@example.com"),
        ("Display", "business_name", " "),
        ("Display", "headlines", "Duplicate\nDuplicate"),
        ("Display", "channel", "Video"),
    ],
)
def test_invalid_channel_configuration(channel, field, value):
    with pytest.raises(ValidationError):
        TypeAdapter(CampaignInput).validate_python({**campaign_data(channel), field: value})


def test_cross_account_assets_rejected():
    p = campaign_data("Demand Gen")
    p["audience"] = "customers/9999999999/audiences/1"
    with pytest.raises(AppError):
        check_resource_accounts("1234567890", p)


@pytest.mark.parametrize("mode", ["valid", "missing", "wrong_size", "wrong_type"])
async def test_image_validation_uses_google_metadata(mode):
    async def google(request):
        rows = []
        for i, w, h in [(1, 1200, 628), (2, 1200, 1200), (3, 128, 128)]:
            if mode == "missing" and i == 1:
                continue
            rows.append(
                {
                    "asset": {
                        "resourceName": f"customers/1234567890/assets/{i}",
                        "type": "TEXT" if mode == "wrong_type" else "IMAGE",
                        "imageAsset": {
                            "fullSize": {
                                "widthPixels": 10 if mode == "wrong_size" else w,
                                "heightPixels": h,
                            }
                        },
                    }
                }
            )
        return httpx.Response(200, json={"results": rows})

    from pydantic import SecretStr

    settings = Settings(
        _env_file=None,
        database_url="postgresql://localhost/test",
        google_ads_developer_token=SecretStr("test"),
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(google)) as http:
        client = GoogleAdsClient(settings, http)
        if mode == "valid":
            await client.validate_images("test", "1234567890", campaign_data("Display"))
        else:
            with pytest.raises(GoogleError):
                await client.validate_images("test", "1234567890", campaign_data("Display"))
