"""Request contracts shared by API documentation and domain validation."""

import re
from decimal import Decimal
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(Input):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def email_address(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email.")
        return value


class WorkspaceName(Input):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if not value.strip():
            raise ValueError("Enter a workspace name.")
        return value.strip()


class Invitation(Input):
    email: str = Field(max_length=254)
    role: Literal["Admin", "Editor", "Publisher", "Viewer"]
    _email = field_validator("email")(Credentials.email_address.__func__)


class RoleChange(Input):
    role: Literal["Admin", "Editor", "Publisher", "Viewer"]


class Transfer(Input):
    user: StrictInt = Field(gt=0)


class AcceptInvite(Input):
    token: str = Field(pattern=r"^[a-f0-9]{64}$")


class AccountSelection(Input):
    customer_id: str
    manager_id: str | None = None

    @field_validator("customer_id", "manager_id")
    @classmethod
    def customer_number(cls, value):
        if not value:
            return value
        value = value.replace("-", "")
        if not re.fullmatch(r"\d{10}", value):
            raise ValueError("Google Ads account IDs must contain ten digits.")
        return value


class CampaignImport(Input):
    campaign_ids: list[str] = Field(max_length=500)


class CampaignStatus(Input):
    status: Literal["PAUSED", "ENABLED"]


class SearchCampaign(Input):
    name: str = Field(min_length=1, max_length=100)
    ad_group: str = Field(min_length=1, max_length=100)
    channel: Literal["Search"] = "Search"
    budget: Decimal = Field(gt=0, le=1_000_000, allow_inf_nan=False)
    cpc: Decimal = Field(gt=0, allow_inf_nan=False)
    country: Literal["India", "United States", "United Kingdom"]
    match_type: Literal["PHRASE", "EXACT"]
    final_url: str = Field(max_length=2048)
    keywords: str
    headlines: str
    descriptions: str
    eu_political: StrictBool

    @field_validator("name", "ad_group")
    @classmethod
    def trim_required(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("A name is required.")
        return value

    @field_validator("final_url")
    @classmethod
    def landing_page(cls, value):
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Use an HTTPS landing page without embedded credentials.")
        return value

    @model_validator(mode="after")
    def validate_ad(self):
        if self.cpc > self.budget:
            raise ValueError("Maximum CPC cannot exceed the daily budget.")
        if self.eu_political:
            raise ValueError("EU political campaigns are not supported.")
        for field, minimum, maximum, length in (
            ("keywords", 1, 100, 80),
            ("headlines", 3, 15, 30),
            ("descriptions", 2, 4, 90),
        ):
            lines = self.lines(getattr(self, field))
            if (
                not minimum <= len(lines) <= maximum
                or len(set(lines)) != len(lines)
                or any(len(line) > length for line in lines)
            ):
                raise ValueError(
                    f"{field}: use {minimum}–{maximum} unique lines, at most {length} characters each."
                )
        return self

    @staticmethod
    def lines(value: str) -> list[str]:
        return [line.strip() for line in value.splitlines() if line.strip()]

    def payload(self) -> dict:
        result = self.model_dump(mode="json")
        result["budget"], result["cpc"] = float(self.budget), float(self.cpc)
        for field in ("keywords", "headlines", "descriptions"):
            result[field] = self.lines(result[field])
        result["geo_id"] = {"India": "2356", "United States": "2840", "United Kingdom": "2826"}[
            self.country
        ]
        return result
