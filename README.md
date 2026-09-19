# Nebula PS3 — Team Gay-lussac

Submission for **NebulaX 2026 Problem Statement 3 — Train Condition Monitoring**: detect faults and
estimate degradation across four rail-vehicle subsystems (Door, ACV, Rail Corrugation, SHM) from
raw sensor time series.

```
frontend/                            the app (PS3 deliverable item 3) — React + Vite
backend/                             model service — see frontend/README.md for the API contract
NebulaX-Hackathon-ProblemStatement/  the organisers' brief, datasets and info kits
Dockerfile                           builds app + models into one image for Cloud Run
.github/workflows/deploy.yml         builds and publishes frontend/ to GitHub Pages
```

## The app

A non-technical user picks a subsystem, drags in a data file, and gets the result on screen with a
download — which is also how the `*_predictions.csv` files in `predictions.zip` are produced.

```bash
cd frontend && npm install && npm run dev
```

It ships with transparent rule baselines that run entirely in the browser, so it works standalone
with no server. Point it at a model backend (from the app header, or `VITE_API_BASE_URL`) to run the
team's trained models instead; the app always shows which engine produced a result.

See **[frontend/README.md](frontend/README.md)** for the baselines, the backend API contract, the
submission schemas and deployment.

## Publishing

There are two deployments, and they differ in one way that matters: **which engine answers.**

| | URL | Engine |
|---|---|---|
| **Cloud Run** | `https://nebulaquestion3-gay-lussac-122875774727.asia-southeast1.run.app/` | the trained models |
| **GitHub Pages** | `https://<owner>.github.io/<repo>/` | in-browser rule baselines |

### Cloud Run — the app and the trained models

The root `Dockerfile` builds both into one image: the React app is compiled and served as static
files by the same FastAPI process that loads the four `*.joblib` experts. One origin, so the
browser never preflights an upload and there is no backend URL for anyone to paste in.

```bash
docker build -t nebula-ps3 .
docker run -p 8080:8080 nebula-ps3        # http://localhost:8080
```

Deployment is continuous: Cloud Run is connected to this repo, so a push to `main` rebuilds and
rolls out. The service needs **2 GiB of memory** — the four models are loaded at startup and the
512 MiB default is not enough.

> Cloud Run caps an HTTP/1 request at 32 MiB. A single rail recording (~16 MB) is fine; dropping a
> whole rail folder at once is not, and falls back to the browser baselines.

### GitHub Pages — the app alone

Enable **Settings → Pages → Source: GitHub Actions** once. Every push to `main` touching `frontend/`
then type-checks, runs the engine checks, builds and publishes. No server, so it runs the
transparent rule baselines; a backend can still be pointed at from the app header.

## Datasets

The full datasets (~6 GB) are not tracked — see `.gitignore`. Re-download them from the
[organisers' repo](https://github.com/aochinwen/NebulaX-Hackathon-ProblemStatement). The label CSVs
and the small Door dataset are tracked, which is enough to run `npm test`.
