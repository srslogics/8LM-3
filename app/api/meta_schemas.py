"""Validated Meta website Traffic/Sales campaigns, single image, Facebook Feed."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from pydantic import Field, StrictBool, field_validator, model_validator

from app.api.schemas import Input, SearchCampaign


class MetaAccount(Input):
    account_id: str = Field(pattern=r"^act_[0-9]{1,30}$")


class MetaImport(Input):
    campaign_ids: list[str] = Field(max_length=500)

    @field_validator("campaign_ids")
    @classmethod
    def ids(cls, value):
        if any(not v.isascii() or not v.isdigit() or len(v) > 30 for v in value):
            raise ValueError("Invalid Meta campaign ID.")
        return list(dict.fromkeys(value))


class MetaDraft(Input):
    name: str = Field(min_length=1, max_length=100)
    adset_name: str = Field(min_length=1, max_length=100)
    ad_name: str = Field(min_length=1, max_length=100)
    objective: Literal["OUTCOME_TRAFFIC", "OUTCOME_SALES"] = "OUTCOME_TRAFFIC"
    daily_budget: Decimal = Field(gt=0, le=1_000_000, decimal_places=2, allow_inf_nan=False)
    budget_scope: Literal["ADSET", "CAMPAIGN"] = "ADSET"
    age_min: int = Field(default=18, ge=18, le=65)
    age_max: int = Field(default=65, ge=18, le=65)
    gender: Literal["ALL", "MEN", "WOMEN"] = "ALL"
    pixel_id: str = Field(default="", pattern=r"^[0-9]{0,30}$")
    conversion_event: Literal[
        "PURCHASE", "ADD_TO_CART", "INITIATED_CHECKOUT", "LEAD", "COMPLETE_REGISTRATION"
    ] = "PURCHASE"
    start_time: datetime | None = None
    end_time: datetime | None = None
    country: Literal["IN", "US", "GB"]
    page_id: str = Field(pattern=r"^[0-9]{1,30}$")
    image_hash: str = Field(pattern=r"^[a-fA-F0-9]{32}$")
    final_url: str = Field(max_length=2048)
    primary_text: str = Field(min_length=1, max_length=1250)
    headline: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=150)
    call_to_action: Literal["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US"] = "LEARN_MORE"
    no_special_category: StrictBool

    _names = field_validator("name", "adset_name", "ad_name", "primary_text", "headline")(
        SearchCampaign.trim_required.__func__
    )
    _url = field_validator("final_url")(SearchCampaign.landing_page.__func__)

    @model_validator(mode="after")
    def category(self):
        if not self.no_special_category:
            raise ValueError(
                "This builder supports only ads outside Meta special ad categories. Use Ads Manager for regulated categories."
            )
        if self.age_min > self.age_max:
            raise ValueError("Minimum age must not exceed maximum age.")
        if self.objective == "OUTCOME_SALES" and not self.pixel_id:
            raise ValueError("Choose a dataset/pixel for website sales optimisation.")
        for date in (self.start_time, self.end_time):
            if date and date.tzinfo is None:
                raise ValueError("Schedule dates must include a time zone.")
        if self.end_time and self.end_time <= (self.start_time or datetime.now(timezone.utc)):
            raise ValueError("End time must be after the start time and in the future.")
        return self

    def payload(self):
        return self.model_dump(mode="json")
