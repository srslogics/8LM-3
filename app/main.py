"""Application composition root. Start: uvicorn app.main:create_app --factory."""

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import auth, campaigns, google, workspaces
from app.core.config import ROOT, Settings
from app.core.errors import AppError
from app.core.middleware import SecurityMiddleware
from app.db.database import Database
from app.integrations.google_ads import GoogleAdsClient
from app.services.auth import AuthService
from app.services.campaigns import CampaignService
from app.services.google_connection import GoogleConnectionService
from app.services.rate_limit import AuthRateLimit
from app.services.workspaces import WorkspaceService

logger = logging.getLogger("eightlm")


@dataclass
class Services:
    settings: Settings
    db: Database
    auth: AuthService
    workspaces: WorkspaceService
    connection: GoogleConnectionService
    campaigns: CampaignService
    rate_limit: AuthRateLimit


def create_app(settings: Settings | None = None, google_transport=None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        db = Database(settings)
        await db.open()
        try:
            async with httpx.AsyncClient(
                timeout=25, follow_redirects=False, transport=google_transport
            ) as http:
                workspace_service = WorkspaceService(db)
                google_client = GoogleAdsClient(settings, http)
                connection = GoogleConnectionService(db, workspace_service, google_client, settings)
                application.state.services = Services(
                    settings,
                    db,
                    AuthService(db),
                    workspace_service,
                    connection,
                    CampaignService(db, workspace_service, connection, google_client),
                    AuthRateLimit(db),
                )
                yield
        finally:
            await db.close()

    application = FastAPI(
        title="8LM API",
        version="2.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.enable_api_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.enable_api_docs else None,
    )

    @application.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        return JSONResponse({"error": exc.message}, status_code=exc.status)

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not return Pydantic's input values: they can include passwords.
        errors = [
            {"field": ".".join(str(part) for part in e["loc"]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            {"error": errors[0]["message"] if errors else "Invalid request.", "fields": errors}, 400
        )

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.error(
            "request_failed id=%s type=%s",
            getattr(request.state, "request_id", ""),
            type(exc).__name__,
        )
        return JSONResponse({"error": "Something went wrong. Please try again."}, 500)

    application.add_middleware(SecurityMiddleware, settings=settings)
    for router in (auth.router, google.router, workspaces.router, campaigns.router):
        application.include_router(router)

    @application.get("/health", tags=["Operations"])
    async def health(request: Request):
        await request.app.state.services.db.get("SELECT 1")
        return {"ok": True}

    application.mount("/", StaticFiles(directory=ROOT / "public", html=True), name="frontend")
    return application
