"""Type-specific campaign contracts. Unsupported settings are rejected, not discarded."""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StrictBool, field_validator, model_validator

from app.api.schemas import Input, SearchCampaign

Asset = Annotated[str, Field(pattern=r"^customers/\d{10}/assets/\d+$")]


class CampaignBase(Input):
    name: str = Field(min_length=1, max_length=100)
    ad_group: str = Field(min_length=1, max_length=100)
    budget: Decimal = Field(gt=0, le=1_000_000, allow_inf_nan=False)
    country: Literal["India", "United States", "United Kingdom"]
    eu_political: StrictBool

    _names = field_validator("name", "ad_group")(SearchCampaign.trim_required.__func__)

    @model_validator(mode="after")
    def non_political(self):
        if self.eu_political:
            raise ValueError("EU political campaigns are not supported.")
        return self

    def payload(self):
        value = self.model_dump(mode="json")
        value["budget"] = float(self.budget)
        if "cpc" in value:
            value["cpc"] = float(value["cpc"])
        value["geo_id"] = {"India": "2356", "United States": "2840", "United Kingdom": "2826"}[
            self.country
        ]
        for key in ("headlines", "descriptions"):
            if key in value:
                value[key] = SearchCampaign.lines(value[key])
        return value


class CreativeCampaign(CampaignBase):
    final_url: str = Field(max_length=2048)
    business_name: str = Field(min_length=1, max_length=25)
    headlines: str = Field(max_length=1500)
    descriptions: str = Field(max_length=1500)
    landscape_image: Asset
    square_image: Asset
    logo: Asset

    _url = field_validator("final_url")(SearchCampaign.landing_page.__func__)
    _business = field_validator("business_name")(SearchCampaign.trim_required.__func__)

    @model_validator(mode="after")
    def text_limits(self):
        pmax = self.channel == "Performance Max"
        for key, minimum, maximum, width in (
            ("headlines", 3 if pmax else 1, 15 if pmax else 5, 30),
            ("descriptions", 2 if pmax else 1, 5, 90),
        ):
            lines = SearchCampaign.lines(getattr(self, key))
            if (
                not minimum <= len(lines) <= maximum
                or len(set(lines)) != len(lines)
                or any(len(s) > width for s in lines)
            ):
                raise ValueError(
                    f"{key}: use {minimum}–{maximum} unique lines, at most {width} characters each."
                )
        if pmax and not any(len(s) <= 15 for s in SearchCampaign.lines(self.headlines)):
            raise ValueError("Performance Max requires one headline of 15 characters or fewer.")
        if pmax and not any(len(s) <= 60 for s in SearchCampaign.lines(self.descriptions)):
            raise ValueError("Performance Max requires one description of 60 characters or fewer.")
        return self


class PerformanceMaxCampaign(CreativeCampaign):
    channel: Literal["Performance Max"]
    long_headline: str = Field(min_length=1, max_length=90)
    conversions_ready: Literal[True]
    _long = field_validator("long_headline")(SearchCampaign.trim_required.__func__)


class DisplayCampaign(CreativeCampaign):
    channel: Literal["Display"]
    long_headline: str = Field(min_length=1, max_length=90)
    cpc: Decimal = Field(gt=0, allow_inf_nan=False)
    _long = field_validator("long_headline")(SearchCampaign.trim_required.__func__)

    @model_validator(mode="after")
    def bid_limit(self):
        if self.cpc > self.budget:
            raise ValueError("Maximum CPC cannot exceed the daily budget.")
        return self


class DemandGenCampaign(CreativeCampaign):
    channel: Literal["Demand Gen"]
    audience: str = Field(pattern=r"^customers/\d{10}/audiences/\d+$")


class ShoppingCampaign(CampaignBase):
    channel: Literal["Shopping"]
    cpc: Decimal = Field(gt=0, allow_inf_nan=False)
    merchant_id: str = Field(pattern=r"^\d{1,20}$")
    feed_label: str = Field(min_length=1, max_length=20, pattern=r"^[A-Z0-9_-]+$")
    campaign_priority: Literal[0, 1, 2] = 0
    all_products_confirmed: Literal[True]

    @model_validator(mode="after")
    def bid_limit(self):
        if self.cpc > self.budget:
            raise ValueError("Maximum CPC cannot exceed the daily budget.")
        return self


CampaignInput = Annotated[
    SearchCampaign
    | PerformanceMaxCampaign
    | DisplayCampaign
    | DemandGenCampaign
    | ShoppingCampaign,
    Field(discriminator="channel"),
]
