# Train Condition Monitoring console

The app for **NebulaX 2026 Problem Statement 3**. A non-technical user picks a subsystem, drops in
a data file, and gets the result on screen with a download — which is also how the
`*_predictions.csv` files in `predictions.zip` are produced (PS3 Section 4.1, items 2 and 3).

React + TypeScript + Vite + Tailwind. It builds to static files and deploys to GitHub Pages.

## Run it

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Engine checks (see [Testing](#testing)) |

## Deploying

Two targets, built from the same source.

### Cloud Run — with the trained models

The repo-root `Dockerfile` compiles this app and hands `dist/` to the backend, which serves it as
static files alongside `/health` and `/predict/*`. Because both sit on one origin, the build sets
`VITE_API_BASE_URL=/` and the app talks to the models with same-origin requests — no CORS, nothing
to configure in the header. Pushing to `main` rebuilds and rolls out; see the root README.

To reproduce it locally:

```bash
VITE_BASE=/ VITE_API_BASE_URL=/ npm run build
cd ../backend && .venv/bin/python serve.py --static ../frontend/dist --port 8080
```

### GitHub Pages — baselines only

`.github/workflows/deploy.yml` builds and publishes on every push to `main` that touches
`frontend/`. Enable it once:

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

The site then serves from `https://<owner>.github.io/<repo>/`. The workflow sets `VITE_BASE` to the
repo name automatically; for a custom domain set `VITE_BASE=/`. No `VITE_API_BASE_URL` is set, so
it runs the in-browser baselines until someone points it at a backend from the header.

## Uploads and validation

| Subsystem | Accepts |
|---|---|
| Door | `.csv` — the single continuous stream |
| ACV | `.xlsx`, `.xls` or `.csv` — one case file per train |
| Rail | `.csv` — one per recording, or drop the whole folder |
| SHM | `.csv` — one per segment, plus an optional `*_Labels.csv` to calibrate |

Folder drops are expanded recursively. Files are checked in two passes so mistakes surface
immediately rather than after a long parse: extension and emptiness at selection time (skipped files
are listed with the reason), then a header sniff of the first 64 KB before any real work — Door
checks for `Datetime` and `Motor current(mA)`, Rail for its 129 columns, ACV for `Car NN - …`
headers, SHM for a usable numeric column. See `src/lib/validate.ts`.

## The two prediction engines

The app runs the same UI over either of two engines, and always says on screen which one produced a
result.

### 1. Built-in baselines (default, no server)

Transparent rules that run entirely in the browser — no upload, no backend, works on GitHub Pages.
They are documented in full in the source and are **not trained models**:

| Subsystem | Method | Source |
|---|---|---|
| Door | Segment on the idle gaps between cycles, then threshold each cycle's mean motor current, separately for Open and Close | `src/lib/engines/door.ts` |
| ACV | Rank cars by how far each runs above the per-timestamp cross-car median cabin temperature | `src/lib/engines/acv.ts` |
| Rail | Compare Side I against Side II axle-box vibration energy; flag robust outliers within the batch | `src/lib/engines/rail.ts` |
| SHM | Rainflow counting + Miner's rule, with the S-N curve calibrated against your own labels | `src/lib/engines/shm.ts` |

The Door baseline reproduces the published ground truth exactly: it recovers all 110 labelled
cycles in `Train.csv` with matching boundaries and labels, which is an **IoU-weighted F1 of 1.000**
under the metric in `Door_Subsystem_Info_Kit.md` Section 4. Thresholds fitted on the first 60% of
the stream classify the held-out remaining 44 cycles with zero errors. `npm test` checks this.

**SHM calibration.** The info kit does not publish the S-N constants, so damage cannot be in the
right units without them. Drop the `Train/` folder together with `Train_Labels.csv` and the app fits
`(m, C)` to minimise MAPE — the metric SHM is scored on — then saves that calibration and reuses it
on your test files. Until you do, SHM reports a relative damage index and says so on screen.

### 2. Model backend (the team's trained models)

Set a backend URL from the app header, or at build time with `VITE_API_BASE_URL`. When it is
reachable the app sends the uploaded files there instead of running the baselines.

Implement these two endpoints:

```
GET  {base}/health
  -> { "status": "ok", "models": { "door": true, "acv": true, "rail": false, "shm": true } }

POST {base}/predict/{door|acv|rail|shm}
  multipart/form-data, repeated field "files"
```

Response per subsystem:

```jsonc
// door — one entry per predicted segment
{ "segments": [ { "start_time": "2023-7-5-0-11-17-664",
                  "end_time":   "2023-7-5-0-11-20-384",
                  "prediction": "Abnormal resistance",
                  "operation": "Open",          // optional, shown in the UI
                  "mean_current": 812.4,        // optional
                  "margin": 0.16 } ] }          // optional

// acv — car ids exactly as they appear in that file's own headers
{ "files": [ { "file_id": "acv_test_case.xlsx",
               "ranked_cars": ["03","01","05","02","04","06","07","08"],
               "scores": { "03": 2.4 } } ] }    // optional

// rail
{ "files": [ { "file_id": "Test1.csv", "prediction": "Side I", "confidence": 0.82 } ] }

// shm
{ "files": [ { "file_id": "test01.csv", "prediction": 0.1037 } ] }
```

Fields marked optional only enrich the charts; the app renders without them. A backend that reports
`"models": { "rail": false }` makes the app fall back to the Rail baseline while still using the
backend for everything else. CORS must allow the Pages origin.

## Submission output

Every run writes the CSV in the exact PS3 schema (Section 4.1), and the **Submission bundle** panel
packages the finished ones into `predictions.zip` with the CSVs at the top level and no subfolders:

| Subsystem | File | Columns |
|---|---|---|
| Door | `door_predictions.csv` | `start_time`, `end_time`, `prediction` — one row per segment, no `file_id` |
| ACV | `acv_predictions.csv` | `file_id`, `ranked_cars` (pipe-separated, no `prediction`) |
| Rail | `rail_predictions.csv` | `file_id`, `prediction` |
| SHM | `shm_predictions.csv` | `file_id`, `prediction` |

## Testing

```bash
npm test
```

Checks the Door baseline against the real `Train.csv` ground truth (skipped automatically if the
dataset folder is absent), Rail's channel mapping and thresholding against synthetic recordings,
and the rainflow counter against the worked example in ASTM E1049 — plus that each subsystem writes
its submission CSV in the right schema.

## Layout

```
src/
├── App.tsx                 # the flow: pick subsystem -> drop files -> run -> result
├── subsystems.ts           # per-subsystem metadata, accepted file types, output filenames
├── types.ts                # result shapes shared by both engines
├── lib/
│   ├── api.ts              # backend client and the response contract
│   ├── runner.ts           # orchestrates reading, dispatch and progress
│   ├── predictionCsv.ts    # the PS3 submission schemas
│   ├── zip.ts              # predictions.zip
│   └── engines/            # the in-browser baselines
└── components/
    ├── charts/             # hand-built SVG charts (no chart library)
    └── results/            # one results view per subsystem
```

The app has two views, addressable by URL hash: a start page at `#/` and the console at `#/app`, so
the browser back button and a shared link both work. Type is Space Grotesk for headings and Inter for
UI text, loaded from Google Fonts with `display=swap` and a system-sans fallback, so text still
paints if the fonts are blocked.

Copy stays short on screen and the long version lives behind an "ⓘ" (`src/components/InfoHint.tsx`),
which opens on hover, keyboard focus or tap and flips below the trigger when there is no room above.
Each subsystem also carries a line-art glyph from `src/components/icons.tsx`.

Colours come from design tokens in `src/index.css`. The categorical slots are validated for
colour-vision deficiency in both light and dark themes, and status colour is always paired with an
icon and a text label so it never carries meaning alone. Dark is the default; the header toggle
stores the viewer's choice.

The ambient backdrop (`src/components/Backdrop.tsx`) is inline SVG rather than a photo — no network
request, no licensing question, and it re-tints with the theme. To use a real photograph, put it in
`public/` and swap the `<svg>` for an `<img>`; the comment at the top of that file has the exact
line.
