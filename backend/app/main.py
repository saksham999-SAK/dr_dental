import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.app.config import settings
from backend.app.api.health import router as health_router
from backend.app.api.models import router as models_router
from backend.app.api.analysis import router as analysis_router
from backend.app.services.model_service import model_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("dental_ai")


class ReflectCORSMiddleware:
    """Always echo the browser Origin.

    Starlette's allow_origin_regex is easy to get wrong, and Railway's edge
    also sends Access-Control-Allow-Credentials: true — so a wildcard `*`
    origin is rejected by the browser. Mirroring the request origin works
    for Vercel production, preview URLs, and local Vite.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        header_map = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        origin = header_map.get("origin")
        request_headers = header_map.get("access-control-request-headers", "*")

        cors_headers = []
        if origin:
            cors_headers = [
                (b"access-control-allow-origin", origin.encode("latin-1")),
                (b"access-control-allow-credentials", b"true"),
                (b"access-control-allow-methods", b"GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"),
                (b"access-control-allow-headers", request_headers.encode("latin-1")),
                (b"access-control-max-age", b"86400"),
                (b"vary", b"Origin"),
            ]

        if scope.get("method") == "OPTIONS" and origin:
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": cors_headers + [(b"content-length", b"0")],
            })
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message: dict) -> None:
            if message["type"] == "http.response.start" and cors_headers:
                existing = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if not k.decode("latin-1").lower().startswith("access-control-")
                    and k.decode("latin-1").lower() != "vary"
                ]
                message = {**message, "headers": existing + cors_headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing DentalAI Backend Services...")
    # Initialize PyTorch / YOLO models once on startup
    model_service.initialize_models()
    yield
    logger.info("Shutting down DentalAI Backend Services...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Smart Dental Diagnosis and Restoration Planning Using Tooth Alignment Analysis",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(ReflectCORSMiddleware)

# Mount API Routers
app.include_router(health_router, prefix=settings.API_V1_PREFIX, tags=["Health"])
app.include_router(models_router, prefix=settings.API_V1_PREFIX, tags=["Models"])
app.include_router(analysis_router, prefix=settings.API_V1_PREFIX, tags=["Analysis"])

@app.get("/")
def root():
    return {
        "app": settings.PROJECT_NAME,
        "title": settings.PROJECT_TITLE,
        "docs": "/docs",
        "health": "/api/health",
        "models": "/api/models/info",
        "status": "online",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
