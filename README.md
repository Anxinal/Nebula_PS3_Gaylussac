# Nebula PS3 — Team Gaylussac

Submission for **NebulaX 2026 Problem Statement 3 — Train Condition Monitoring**: detect faults and
estimate degradation across four rail-vehicle subsystems (Door, ACV, Rail Corrugation, SHM) from
raw sensor time series.

```
frontend/                            the app (PS3 deliverable item 3) — React + Vite, deploys to GitHub Pages
backend/                             model service (optional) — see frontend/README.md for the API contract
NebulaX-Hackathon-ProblemStatement/  the organisers' brief, datasets and info kits
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

Enable **Settings → Pages → Source: GitHub Actions** once. Every push to `main` touching `frontend/`
then type-checks, runs the engine checks, builds and publishes to
`https://<owner>.github.io/<repo>/`.

## Datasets

The full datasets (~6 GB) are not tracked — see `.gitignore`. Re-download them from the
[organisers' repo](https://github.com/aochinwen/NebulaX-Hackathon-ProblemStatement). The label CSVs
and the small Door dataset are tracked, which is enough to run `npm test`.
