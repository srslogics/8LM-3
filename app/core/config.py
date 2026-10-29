"""Validated, server-only configuration. Environment overrides local files."""

from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import certifi
from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT / ".env.local"), extra="ignore")
    database_url: SecretStr
    database_url_unpooled: SecretStr | None = None
    app_env: str = Field("development", validation_alias=AliasChoices("APP_ENV", "NODE_ENV"))
    app_origin: str = ""
    render_external_url: str = ""
    port: int = 8000
    google_client_id: str = Field(
        "", validation_alias=AliasChoices("GOOGLE_CLIENT_ID", "GOOGLE_ADS_CLIENT_ID")
    )
    google_client_secret: SecretStr = Field(
        SecretStr(""),
        validation_alias=AliasChoices("GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_CLIENT_SECRET"),
    )
    google_ads_developer_token: SecretStr = SecretStr("")
    google_ads_api_version: str = "v26"
    neon_branch: str = ""
    database_pool_size: int = Field(5, ge=2, le=30)
    enable_api_docs: bool = False

    @property
    def production(self) -> bool:
        return self.app_env == "production"

    @property
    def origin(self) -> str:
        return (
            self.app_origin or self.render_external_url or f"http://localhost:{self.port}"
        ).rstrip("/")

    @property
    def oauth_ready(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret.get_secret_value())

    @model_validator(mode="after")
    def validate_origin(self):
        parsed = urlsplit(self.origin)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
        ):
            raise ValueError("APP_ORIGIN must be an HTTP(S) origin without a path.")
        if self.production and parsed.scheme != "https":
            raise ValueError("Production APP_ORIGIN must use HTTPS.")
        return self


def connection_url(secret: SecretStr) -> str:
    """Verify Neon TLS; remove Node-only URL parameters when sharing existing env."""
    parsed = urlsplit(secret.get_secret_value())
    params = dict(parse_qsl(parsed.query))
    params.pop("uselibpqcompat", None)
    if (parsed.hostname or "").endswith(".neon.tech"):
        params["sslmode"] = "verify-full"
        params.setdefault("sslrootcert", certifi.where())
    return urlunsplit(parsed._replace(query=urlencode(params)))
