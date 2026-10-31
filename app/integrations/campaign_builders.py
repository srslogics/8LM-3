"""Atomic Google Ads operations for the supported non-Search formats."""

from app.core.errors import AppError

CHANNELS = {
    "Search": "SEARCH",
    "Performance Max": "PERFORMANCE_MAX",
    "Display": "DISPLAY",
    "Demand Gen": "DEMAND_GEN",
    "Shopping": "SHOPPING",
}


def check_resource_accounts(customer, payload):
    for key in ("landscape_image", "square_image", "logo", "audience"):
        if payload.get(key) and not payload[key].startswith(f"customers/{customer}/"):
            raise AppError("Choose assets and audiences from the selected Google Ads account.")


def operation(resource, **fields):
    return {resource + "Operation": {"create": fields}}


def build_operations(customer, p, key, micros):
    check_resource_accounts(customer, p)
    channel = p["channel"]
    if channel not in CHANNELS or channel == "Search":
        raise AppError("Unsupported campaign type.")
    base = f"customers/{customer}"
    budget, campaign, group = (
        f"{base}/campaignBudgets/-1",
        f"{base}/campaigns/-2",
        f"{base}/adGroups/-3",
    )
    config = dict(
        resourceName=campaign,
        name=f"{p['name']} [8LM {key}]",
        advertisingChannelType=CHANNELS[channel],
        status="PAUSED",
        campaignBudget=budget,
        containsEuPoliticalAdvertising="DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        geoTargetTypeSetting={"positiveGeoTargetType": "PRESENCE"},
    )
    if channel == "Performance Max":
        config.update(
            maximizeConversions={},
            brandGuidelinesEnabled=True,
            assetAutomationSettings=[
                {
                    "assetAutomationType": "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION",
                    "assetAutomationStatus": "OPTED_OUT",
                }
            ],
        )
    elif channel == "Demand Gen":
        config["targetSpend"] = {}  # Maximize clicks; no conversion prerequisite.
        config["demandGenCampaignSettings"] = {"upgradedTargeting": False}
    else:
        config["manualCpc"] = {}
    if channel == "Shopping":
        config["shoppingSetting"] = {
            "merchantId": p["merchant_id"],
            "feedLabel": p["feed_label"],
            "campaignPriority": p["campaign_priority"],
            "enableLocal": False,
        }
    ops = [
        operation(
            "campaignBudget",
            resourceName=budget,
            name=f"8LM budget {key}",
            amountMicros=micros(p["budget"]),
            deliveryMethod="STANDARD",
            explicitlyShared=False,
        ),
        operation("campaign", **config),
        operation(
            "campaignCriterion",
            campaign=campaign,
            location={"geoTargetConstant": "geoTargetConstants/" + p["geo_id"]},
        ),
        operation(
            "campaignCriterion",
            campaign=campaign,
            language={"languageConstant": "languageConstants/1000"},
        ),
    ]
    if channel == "Performance Max":
        asset_group = f"{base}/assetGroups/-3"
        # Brand assets belong to the campaign; all text assets and links are created atomically.
        text_assets = [
            ("BUSINESS_NAME", p["business_name"]),
            *[("HEADLINE", s) for s in p["headlines"]],
            ("LONG_HEADLINE", p["long_headline"]),
            *[("DESCRIPTION", s) for s in p["descriptions"]],
        ]
        links = []
        for i, (field, text) in enumerate(text_assets, 10):
            resource = f"{base}/assets/-{i}"
            ops.append(operation("asset", resourceName=resource, textAsset={"text": text}))
            links.append((field, resource))
        ops.append(
            operation(
                "campaignAsset", campaign=campaign, asset=links[0][1], fieldType="BUSINESS_NAME"
            )
        )
        ops.append(operation("campaignAsset", campaign=campaign, asset=p["logo"], fieldType="LOGO"))
        ops.append(
            operation(
                "assetGroup",
                resourceName=asset_group,
                name=p["ad_group"],
                campaign=campaign,
                status="ENABLED",
                finalUrls=[p["final_url"]],
            )
        )
        for field, resource in links[1:] + [
            ("MARKETING_IMAGE", p["landscape_image"]),
            ("SQUARE_MARKETING_IMAGE", p["square_image"]),
        ]:
            ops.append(
                operation(
                    "assetGroupAsset", assetGroup=asset_group, asset=resource, fieldType=field
                )
            )
        return ops
    group_config = dict(resourceName=group, name=p["ad_group"], campaign=campaign, status="ENABLED")
    if channel == "Demand Gen":
        group_config["audienceSetting"] = {"useAudienceGrouped": True}
        group_config["optimizedTargetingEnabled"] = False
    else:
        group_config.update(
            type="DISPLAY_STANDARD" if channel == "Display" else "SHOPPING_PRODUCT_ADS",
            cpcBidMicros=micros(p["cpc"]),
        )
    ops.append(operation("adGroup", **group_config))
    if channel == "Shopping":
        ops.append(
            operation(
                "adGroupCriterion",
                adGroup=group,
                status="ENABLED",
                listingGroup={"type": "UNIT"},
                cpcBidMicros=micros(p["cpc"]),
            )
        )
        ad = {"shoppingProductAd": {}}
    else:
        creative = {
            "businessName": p["business_name"],
            "headlines": [{"text": s} for s in p["headlines"]],
            "descriptions": [{"text": s} for s in p["descriptions"]],
            "marketingImages": [{"asset": p["landscape_image"]}],
            "squareMarketingImages": [{"asset": p["square_image"]}],
        }
        if channel == "Display":
            creative.update(
                longHeadline={"text": p["long_headline"]}, squareLogoImages=[{"asset": p["logo"]}]
            )
        else:
            creative["logoImages"] = [{"asset": p["logo"]}]
            ops.append(
                operation(
                    "adGroupCriterion",
                    adGroup=group,
                    status="ENABLED",
                    audience={"audience": p["audience"]},
                )
            )
        ad = {
            "finalUrls": [p["final_url"]],
            "responsiveDisplayAd" if channel == "Display" else "demandGenMultiAssetAd": creative,
        }
    ops.append(operation("adGroupAd", adGroup=group, status="ENABLED", ad=ad))
    return ops
