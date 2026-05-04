"""Entry point for the EVolocity dashboard backend.

Initializes the FastAPI application, registers all routers, configures CORS,
sets up the database on startup, and provides the uvicorn launch configuration.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import competitions, alerts, ecu, firmware, scoring, teams, violations, websocket
from serial_reader import run as serial_run

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Database ready")
    if settings.SERIAL_PORT:
        asyncio.create_task(serial_run(settings.SERIAL_PORT, settings.SERIAL_BAUD))
        logger.info("Serial reader started on %s at %d baud", settings.SERIAL_PORT, settings.SERIAL_BAUD)
    else:
        logger.info("No SERIAL_PORT configured — serial reader disabled")
    yield
    logger.info("Shutting down")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="EVolocity Dashboard API",
        description="Backend API for the EVolocity vehicle dashboard",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS configuration, might not be needed but leaving here for now
    allowed_origins = [
        origin.strip()
        for origin in settings.ALLOWED_ORIGINS.split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS configured for origins: %s", allowed_origins)

    # Register routers
    app.include_router(ecu.router, prefix="/api")
    app.include_router(alerts.router, prefix="/api")
    app.include_router(firmware.router, prefix="/api")
    app.include_router(scoring.router, prefix="/api")
    app.include_router(competitions.router, prefix="/api")
    app.include_router(teams.router, prefix="/api")
    app.include_router(violations.router, prefix="/api")
    app.include_router(websocket.router)
    logger.info("All routers registered")

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        ssl_certfile=settings.TLS_CERT_PATH,
        ssl_keyfile=settings.TLS_KEY_PATH,
        log_level="info",
    )