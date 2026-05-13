"""FastAPI main application."""

from dotenv import load_dotenv
load_dotenv()  # Load .env file BEFORE other imports that need env vars

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

# ── Logfire (Pydantic) observability ──────────────────────────────────────────
# Configure as early as possible so subsequent imports are instrumented.
# Fails open (send_to_logfire="if-token-present") so local dev without a token
# doesn't crash. When LOGFIRE_TOKEN is set, spans + structured logs ship to
# https://logfire.pydantic.dev for the configured service.
import logfire

logfire.configure(
    service_name="devproof-ai-engine",
    service_version=os.getenv("GIT_SHA") or "dev",
    send_to_logfire="if-token-present",
    console=False,  # don't double-print to stdout — uvicorn already logs
)

from app.routes import search, ingest, issues, users

# Setup logging — pipe stdlib logs through logfire so [v4-bg], [v4-cache] etc.
# show up as Logfire log entries linked to their parent spans.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logfire.LogfireLoggingHandler()],
)

# Create FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables (only if database is configured)
    from app.database import engine, Base
    if engine is not None:
        from app.models import issues, project  # noqa: F401
        from app.models import audit_v4_shadow  # noqa: F401
        from app.models import hackathon  # noqa: F401
        Base.metadata.create_all(bind=engine)
    else:
        logging.warning("DATABASE_URL not set - skipping table creation")
    yield
    # Shutdown: Clean up resources if needed

app = FastAPI(
    title="GitHub Contribution Finder",
    description="AI-powered search for open source contribution opportunities",
    version="1.0.0",
    lifespan=lifespan
)

# Logfire — auto-instrument FastAPI routes, SQLAlchemy queries, and outbound
# httpx calls. Each request becomes a parent span; child spans capture DB
# queries and external HTTP traffic. No-op when LOGFIRE_TOKEN is unset.
logfire.instrument_fastapi(app, capture_headers=False)
try:
    from app.database import engine as _db_engine
    if _db_engine is not None:
        logfire.instrument_sqlalchemy(engine=_db_engine)
except Exception as _e:  # pragma: no cover - defensive
    logging.warning("logfire.instrument_sqlalchemy failed: %s", _e)
try:
    logfire.instrument_httpx()
except Exception as _e:  # pragma: no cover - defensive
    logging.warning("logfire.instrument_httpx failed: %s", _e)

# CORS middleware for frontend
# When allow_credentials=True, allow_origins cannot be ["*"]
# Must specify exact origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://orenda.vision",
        "https://www.orenda.vision",
        "https://contribfinder.com",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],

)

# Include routers
app.include_router(search.router)
app.include_router(ingest.router)
app.include_router(issues.router)
app.include_router(users.router)
from app.routes import projects
app.include_router(projects.router)
from app.routes.v4_diagnostic import router as v4_diagnostic_router
app.include_router(v4_diagnostic_router)
from app.routes import profile
app.include_router(profile.router)
from app.routes import hackathons
app.include_router(hackathons.router)


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "GitHub Contribution Finder API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "search": "POST /api/search",
            "ingest": "POST /api/ingest/start",
            "status": "GET /api/ingest/status",
            "health": "GET /api/search/health"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}
