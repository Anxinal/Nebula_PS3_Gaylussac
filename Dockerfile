# syntax=docker/dockerfile:1
#
# One image, one Cloud Run service: the React app and the trained models are
# served from the same origin, so the browser never preflights an upload and
# there is no second URL for anyone to configure.
#
#   docker build -t nebula-ps3 .
#   docker run -p 8080:8080 nebula-ps3      # http://localhost:8080

# ---------------------------------------------------------------------------
# Stage 1 - build the frontend.
# ---------------------------------------------------------------------------
FROM node:22-slim AS web

WORKDIR /build

# Dependencies first: this layer is only rebuilt when the lockfile moves.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Served from the service root, not a GitHub Pages sub-path, and the API is on
# this same origin - so both are "/". (api.ts strips the trailing slash, which
# turns "/" into same-origin requests for /health and /predict/*.)
ENV VITE_BASE=/ \
    VITE_API_BASE_URL=/

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 - the service.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    CDM_STATIC_DIR=/app/static \
    PORT=8080

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# cdm/paths.py resolves ARTIFACTS_DIR relative to the package parent, so the
# trained models (~2 MB, tracked in git) must land at /app/artifacts.
COPY backend/cdm/ ./cdm/
COPY backend/rail_cdm/ ./rail_cdm/
COPY backend/artifacts/ ./artifacts/
COPY backend/configs/ ./configs/

COPY --from=web /build/dist/ ./static/

# Don't run the service as root.
RUN useradd --create-home --uid 1001 app && chown -R app:app /app
USER app

EXPOSE 8080

# Cloud Run injects $PORT and requires 0.0.0.0. One worker: the four models are
# loaded into memory at startup, and a second copy would double the footprint.
CMD exec uvicorn cdm.server:app --host 0.0.0.0 --port ${PORT} --workers 1
