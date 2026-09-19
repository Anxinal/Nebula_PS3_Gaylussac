"""HTTP API serving the trained models to the frontend.

Implements the contract the app documents in ``frontend/README.md``:

    GET  /health                 -> {"status": "ok", "models": {"door": true, ...}}
    POST /predict/{subsystem}    multipart/form-data, repeated field "files"

Each response carries the prediction and its explanation in **separate fields**,
so the UI can render a result without parsing prose and can show the reasoning
beside it. Required fields match the contract exactly; the extra ones
(``trace``, ``bins``, ``series``, ``explanation``) enrich the charts and are
safe for the client to ignore.

Run it with::

    .venv/bin/python -m cdm.server            # or: .venv/bin/python serve.py
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import SUBSYSTEMS
from .pipeline import HierarchicalPipeline
from .router import UNKNOWN, SubsystemRouter

log = logging.getLogger("cdm.server")

#: Upload ceiling. A rail recording is ~16 MB; this leaves room for a batch
#: without letting a single request exhaust memory.
MAX_UPLOAD_BYTES = 256 * 1024 * 1024

ALLOWED_SUFFIXES = {".csv", ".xlsx", ".xls"}

_state: dict = {"pipeline": None, "router": SubsystemRouter()}


def get_pipeline() -> HierarchicalPipeline:
    if _state["pipeline"] is None:
        raise HTTPException(status_code=503, detail="models are still loading")
    return _state["pipeline"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load once at startup rather than per request - the rail forest alone is
    # 1200 trees, and unpickling it on every upload would dominate latency.
    log.info("loading models ...")
    _state["pipeline"] = HierarchicalPipeline.load()
    ready = sorted(_state["pipeline"].experts)
    log.info("models ready: %s", ", ".join(ready) if ready else "none")
    yield
    _state["pipeline"] = None


def create_app(
    *,
    allow_origins: list[str] | None = None,
    static_dir: str | Path | None = None,
) -> FastAPI:
    app = FastAPI(
        title="NebulaX PS3 condition monitoring",
        description="Trained rail-vehicle fault models behind a JSON API.",
        version="0.3.0",
        lifespan=lifespan,
    )

    # The app is served from GitHub Pages, a different origin, so the browser
    # will preflight every upload.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins or ["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        """Which models are loaded, so the app can fall back per subsystem."""
        pipeline = _state["pipeline"]
        loaded = set(pipeline.experts) if pipeline else set()
        return {
            "status": "ok" if loaded else "loading",
            "models": {name: name in loaded for name in SUBSYSTEMS},
        }

    @app.post("/predict/{subsystem}")
    async def predict(subsystem: str, files: list[UploadFile] = File(...)) -> JSONResponse:
        if subsystem not in SUBSYSTEMS:
            raise HTTPException(
                status_code=404,
                detail=f"unknown subsystem '{subsystem}'; expected one of {', '.join(SUBSYSTEMS)}",
            )
        pipeline = get_pipeline()
        expert = pipeline.experts.get(subsystem)
        if expert is None:
            raise HTTPException(status_code=503, detail=f"no trained model for '{subsystem}'")
        if not files:
            raise HTTPException(status_code=400, detail="no files uploaded")

        # The experts read from disk (a rail file is 10000x129), so uploads are
        # staged in a temp directory that is removed however the request ends.
        with tempfile.TemporaryDirectory(prefix="cdm-upload-") as workdir:
            saved = await _stage_uploads(files, Path(workdir))
            _reject_mismatched(saved, subsystem)
            try:
                payload = expert.web_payload(saved)
            except NotImplementedError as exc:
                raise HTTPException(status_code=501, detail=str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 - surface the cause to the UI
                log.exception("prediction failed for %s", subsystem)
                raise HTTPException(
                    status_code=422,
                    detail=f"could not score these files as '{subsystem}': {exc}",
                ) from exc

        payload["subsystem"] = subsystem
        payload["n_files"] = len(saved)
        return JSONResponse(payload)

    # Optionally serve the built frontend from this same app. That is what lets
    # a single Cloud Run service answer both the page and its uploads: same
    # origin, so the browser never preflights and there is no second URL to
    # configure. Mounted last - a mount on "/" matches every path, and would
    # shadow /health and /predict if it were registered before them.
    if static_dir is not None:
        root = Path(static_dir)
        if root.is_dir():
            app.mount("/", StaticFiles(directory=root, html=True), name="frontend")
            log.info("serving the frontend from %s", root)
        else:
            log.warning("no frontend at %s - serving the API only", root)

    return app


async def _stage_uploads(files: list[UploadFile], workdir: Path) -> list[Path]:
    """Write uploads to disk, rejecting anything oversized or unsupported."""
    saved: list[Path] = []
    total = 0
    for upload in files:
        name = Path(upload.filename or "upload").name  # strip any path component
        if Path(name).suffix.lower() not in ALLOWED_SUFFIXES:
            raise HTTPException(
                status_code=400,
                detail=f"'{name}' is not a .csv or .xlsx file",
            )
        destination = workdir / name
        with destination.open("wb") as handle:
            shutil.copyfileobj(upload.file, handle)
        await upload.close()

        total += destination.stat().st_size
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"upload exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
            )
        saved.append(destination)
    return saved


def _reject_mismatched(paths: list[Path], subsystem: str) -> None:
    """Refuse files whose structure belongs to a different subsystem.

    Reusing the stage-1 router here turns a confusing downstream crash - or,
    worse, a confident wrong answer - into a clear message naming what was
    actually uploaded.
    """
    router: SubsystemRouter = _state["router"]
    for path in paths:
        routing = router.route(path)
        if routing.subsystem == subsystem:
            continue
        if routing.subsystem == UNKNOWN:
            raise HTTPException(
                status_code=400,
                detail=f"'{path.name}' does not look like any known subsystem file "
                       f"({routing.reason})",
            )
        raise HTTPException(
            status_code=400,
            detail=f"'{path.name}' looks like a {routing.subsystem} file, not {subsystem} "
                   f"({routing.reason}). Upload it under /predict/{routing.subsystem}.",
        )


def _origins_from_env() -> list[str]:
    raw = os.environ.get("CDM_ALLOW_ORIGINS", "*")
    return [o.strip() for o in raw.split(",") if o.strip()]


#: The ASGI app a host imports as ``cdm.server:app`` - this is what the
#: container runs. Both knobs are optional: with neither set this is the
#: API-only app the tests use.
#:
#:   CDM_STATIC_DIR     directory of the built frontend to serve at "/"
#:   CDM_ALLOW_ORIGINS  comma-separated CORS origins (default: any)
app = create_app(static_dir=os.environ.get("CDM_STATIC_DIR") or None,
                 allow_origins=_origins_from_env())


def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--origins", default="*",
                        help="comma-separated CORS origins (default: any)")
    parser.add_argument("--static", default=os.environ.get("CDM_STATIC_DIR"),
                        help="serve a built frontend (frontend/dist) at / as well")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    origins = [o.strip() for o in args.origins.split(",") if o.strip()]
    uvicorn.run(
        "cdm.server:app" if args.reload
        else create_app(allow_origins=origins, static_dir=args.static),
        host=args.host, port=args.port, reload=args.reload,
    )


if __name__ == "__main__":
    main()
