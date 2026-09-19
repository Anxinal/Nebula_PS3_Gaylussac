# Rail Vehicle Condition Monitoring — Hierarchical Tree Models

Backend for **Problem Statement 3**, covering all four subsystems behind a
two-stage architecture:

```
            input file (.csv / .xlsx)
                     |
       STAGE 1  subsystem router  (deterministic schema dispatch)
                     |
   +---------+-------+-------+---------+----------+
   |         |               |         |          |
  rail      shm             acv      door      unknown
   |         |               |         |          |
 3-class   damage        car ranking  segment   rejected
 forest   regression      forest      + forest
```

## Results

| Subsystem | Task | Metric | Model | Score |
|---|---|---|---|---|
| **Door** | segment + classify | IoU-weighted F1 | gap segmentation + RF | **1.0000** |
| **ACV** | fault localisation | linear rank-decay | per-car RF, leave-one-case-out | **0.9792** |
| **SHM** | **regression** | max(0, 1 − MAPE) | Miner's-rule anchor + residual RF | **0.9463** |
| **Rail** | 3-class | macro F1 | per-side binary ExtraTrees | **0.7230** |

**Overall Score (÷4) = 0.9121.** All scores are cross-validated on training
data only; see *Caveats* below for how much to trust each.

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python -m cdm.cli rules                        # routing rules
.venv/bin/python -m cdm.cli train                        # fit all four experts
.venv/bin/python -m cdm.cli diagnose --input <file|dir>  # route + verdict
.venv/bin/python -m cdm.cli predict --input <dir> --output-dir submissions/
.venv/bin/python -m pytest tests/ -q                     # 46 tests
```

`predict` accepts a **mixed** directory: it routes each file to the right
expert and writes all four `*_predictions.csv` in their required schemas.

## Stage 1: the router is deliberately not a learned model

The four subsystems' formats are mutually exclusive by construction, so the
routing rules are exact:

| Subsystem | Identified by |
|---|---|
| ACV | `.xlsx` with `Car <NN> - <parameter>` headers |
| Rail | axle-box channels + a rotating-speed column (129 cols) |
| SHM | headerless single-column stress series |
| Door | timestamped controller stream, 10–30 columns |

A classifier trained on these could at best reproduce the rules while adding a
failure mode they do not have: a tree always returns *some* class, so an
unrecognised file would be handed silently to the wrong expert. The rules
return `unknown` instead, and say why — verified by test, and by feeding the
pipeline a label CSV that it correctly refuses.

## Stage 2: the four experts

**Door — `cdm/experts/door.py`.** The Info Kit warns against assuming the
opening/closing flags mark cycle boundaries, and rightly: those flags are
asserted across the whole stream and yield *one* run. The real boundary is the
**sampling gap** — 20 ms within a cycle, 20–47 s between them. Splitting on
gaps > 1 s recovers all 110 training cycles at **IoU = 1.000**. With
segmentation exact, the IoU-weighted F1 collapses algebraically to label
accuracy. Classification keys on `current / back-EMF` (torque per unit speed —
a direct resistance proxy), which alone reaches AUC 0.996.

**ACV — `cdm/experts/acv.py`.** A refrigerant leak means lost cooling
capacity, so the affected car cannot reach its setpoint and runs warmer than
its seven siblings under identical conditions. Every feature is therefore
*fleet-relative*. `acv_case_04` uses a different 63-parameter schema, so
columns resolve through a canonical-role map rather than being hard-coded —
which keeps a sixth of the training data in play instead of dropping it.

**SHM — `cdm/experts/shm.py`.** A **regression** task. Miner's rule gives
`D = (1/C) · Σ nᵢ·σᵢ^m`, so a real rainflow counter (ASTM E1049) extracts
cycles and computes the stress moment `S_m` for several exponents. On this
data `log(damage)` tracks `log(S₅)` at **r = 0.9971** — though the fitted slope
is 2.30, not the 1.0 textbook Miner's rule requires (`slope × m ≈ 11` for every
exponent tried), so the reference values are *not* from a single-slope S-N
curve and `m=5` is a fitted basis exponent, not a material property. That matters: a plain
forest over all features scores 0.907, *worse* than a one-feature linear fit
on the physics at 0.940, because a forest adds variance to what is nearly an
exact power law. The expert therefore anchors on the linear Miner's term and
puts the forest on the **residual** — 0.946.

**Rail — `cdm/experts/rail.py`.** Adapter over the `rail_cdm` package; the
deep-dive below is unchanged.

## HTTP API for the frontend

```bash
.venv/bin/python serve.py                      # http://127.0.0.1:8000, /docs for the schema
.venv/bin/python serve.py --origins https://anxinal.github.io
.venv/bin/python serve.py --static ../frontend/dist   # also serve the built app at /
```

Implements the contract in `frontend/README.md`, so the app switches from its
in-browser baselines to the trained models as soon as this is reachable. Port
8000 matches the frontend's default `VITE_API_BASE_URL`.

```
GET  /health              -> {"status":"ok","models":{"rail":true,"shm":true,"acv":true,"door":true}}
POST /predict/{subsystem} multipart/form-data, repeated field "files" (.csv / .xlsx)
```

`--static` (or `$CDM_STATIC_DIR`) mounts a built frontend at `/`, which is how
the deployed container serves the app and the models from one origin — the
mount goes on last so it cannot shadow `/health` or `/predict`. `$CDM_ALLOW_ORIGINS`
sets CORS when the app is hosted elsewhere. See the root README for Cloud Run.

**Prediction and explanation are separate fields**, so the UI can render a
result without parsing prose and show the reasoning beside it:

```jsonc
// POST /predict/rail
{ "files": [ {
    "file_id": "Test13.csv",
    "prediction": "Side I",            // the answer
    "confidence": 0.391,
    "side_i": 0.391, "side_ii": 0.194, // per-rail scores behind the call
    "n_rows": 10000, "speed_kmh": 46.3,
    "explanation": {                   // the reasoning, in its own field
      "plain_summary": "because Side I vs Side II difference in vibration variability is too low",
      "reasons": [ "...", "..." ],
      "top_nodes": [ { "plain": "...", "rule": "contrast__vib__std__max <= -0.01234",
                       "contribution": -0.0723, "n_trees": 132 } ],
      "top_features": [ { "feature": "...", "feature_label": "...", "shap": 0.0197 } ]
    } } ] }
```

Each subsystem also returns what its chart needs — door a downsampled current
`trace` plus per-segment `operation`/`margin`/offsets, SHM rainflow `bins`, ACV
per-car `series` and a plain-English `evidence` line per car. All of it is
optional for the client.

`web_payload()` on each expert builds these, so subsystem knowledge stays in the
expert and `cdm/server.py` stays thin.

**Uploading a file to the wrong endpoint is refused, not guessed at.** The
stage-1 router checks every upload and names where it belongs:

```
POST /predict/door  with a rail file
400: 'Test1.csv' looks like a rail file, not door (axle-box vibration channels
     with a rotating-speed column). Upload it under /predict/rail.
```

Models load once at startup, not per request. Uploads are staged in a temp
directory that is removed however the request ends, capped at 256 MB.

## Explainability

Every expert is a tree ensemble, so each prediction reports **why** — in plain
language, backed by exact figures.

```
[door] FAULT: 38 door cycles found, 12 showing abnormal resistance
    because motor current in stroke phase 4 of 8 is too high; and current drawn
    per unit of door travel (effort against resistance) is too high
```

Two complementary decompositions (`cdm/explain.py`):

- **Node-path decomposition** — the *most salient node*. Walking the decision
  path the sample actually took, each node moves the prediction from its own
  value to its chosen child's. The steps telescope exactly:
  `base + Σ contributions == predicted value`, asserted by test. For a forest
  the per-tree walks are averaged (valid — a forest's prediction *is* that mean)
  and grouped by `(feature, direction)`, so the output reads as one rule the
  ensemble applied rather than thousands of node ids.
- **SHAP feature attribution** via `TreeExplainer` — answers "which *feature*
  mattered", where the node walk answers "which *split* fired". Different
  questions, so both are reported.

`cdm/glossary.py` turns systematic feature names back into English —
`contrast__vib__wlfrac2__mean` becomes *"Side I vs Side II difference in the
share of energy at 8–16 cm wavelength"*. Unmapped names fall back to the raw
column, never a wrong guess.

**Where it lands.** `diagnose` prints the plain reason per file (`--nodes N`
for the full numeric decomposition). `predict` writes `explanations.json`
alongside the submission CSVs — one entry per file carrying `plain_summary`,
`reasons`, and per node the readable text *plus* `rule`, `threshold`,
`direction`, `contribution`, `n_trees`. Submission CSV schemas are never
touched. Explanations cost roughly 2.4× the runtime (16 s → 39 s over 87
files); pass `--no-explain` to skip them.

## Caveats

- **Door's 1.0000 is on 110 training segments** and survives nested threshold
  selection across 8 seeds, but the classes are very nearly linearly
  separable, which suggests cleanly-injected faults. Do not expect 1.0 held out.
- **ACV has 6 labelled cases.** Leave-one-case-out over 6 is extremely noisy;
  0.9792 means "5 firsts and one second", and a single held-out case could
  move it a lot. The physics-only ranking (0.8958) is the safer fallback and
  is retained in the code.
- **SHM assumes a single effective S-N exponent** across two lines and two
  load conditions. Splitting the calibration per latent regime was tested and
  is *worse* (0.944 vs 0.946) — 64 files do not survive being halved. A
  held-out file from an unrepresented condition could still sit outside the
  fitted range, and forests cannot extrapolate.
- **Rail is the weakest and best understood** — see below.

---

## Module layout

| Module | Responsibility |
|---|---|
| `cdm/schema.py` | Cheap structural fingerprint of a file (header only) |
| `cdm/router.py` | Stage-1 deterministic subsystem dispatch |
| `cdm/base.py` | `SubsystemExpert` contract and `Verdict` |
| `cdm/experts/{rail,shm,acv,door}.py` | The four stage-2 models |
| `cdm/pipeline.py` | Route → dispatch → verdict; train/save/load all experts |
| `cdm/cli.py` | `rules` / `train` / `diagnose` / `predict` |
| `rail_cdm/` | The rail corrugation implementation (appendix below) |

---

# Appendix — Rail Corrugation deep dive

The rail subsystem predates the hierarchical stack and has the most
development behind it. `cdm/experts/rail.py` is only a thin adapter over the
package documented here.

## Rail-only commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python -m rail_cdm.cli train                 # cross-validate + fit
.venv/bin/python -m rail_cdm.cli explain --top 25      # SHAP importances
.venv/bin/python scripts/predict.py \
    --input ../NebulaX-Hackathon-ProblemStatement/PS3/02_Datasets/Rail_Corrugation/Test \
    --output rail_predictions.csv
.venv/bin/python -m pytest tests/ -q
```

## Module layout

| Module | Responsibility |
|---|---|
| `rail_cdm/config.py` | Typed config — paths, feature/model/CV parameters, physical constants |
| `rail_cdm/signal_features.py` | Pure signal processing: speed recovery, Welch PSD, wavelength bands, side contrast |
| `rail_cdm/dataloader.py` | Raw CSV → pooled feature matrix, parquet-cached; per-file and per-side frames |
| `rail_cdm/model.py` | `ExtraTreesClassifier` + SHAP `TreeExplainer`, side-probability combination, persistence |
| `rail_cdm/trainer.py` | Repeated grouped CV, threshold tuning, final fit |
| `rail_cdm/evaluator.py` | Macro F1, per-class breakdown, speed-confound diagnostics |
| `rail_cdm/cli.py` | `train` / `evaluate` / `explain` / `predict` |
| `scripts/predict.py` | The `--input`/`--output` inference script the Info Kit requires |

---

## The central problem: speed is a confound

Profiling the speed sensor (90-tooth wheel, 0.85 m diameter) across all 272
training files exposes a trap:

| | count | speed range |
|---|---|---|
| Normal | 234 | **0 – 19.5 m/s** (44 completely stationary) |
| Side I | 14 | 9.7 – 18.6 m/s |
| Side II | 24 | 11.7 – 18.5 m/s |

**Every fault recording was captured above 9.7 m/s.** A threshold on speed
alone scores **macro F1 0.416** — far above the 0.308 of always predicting
Normal. A model fed raw amplitude would quietly learn "fast means faulty" and
then collapse on a held-out set with a different speed mix. The problem
statement (§3.2) marks exactly this down: *"a high score achieved through a
leaky split will not score well."*

Three defences are built in:

1. **Wavelength-domain features.** Corrugation is a fixed-*wavelength* wear
   pattern that excites the axle box at `f = v / λ`. Working in λ rather than
   frequency makes the signature speed-invariant — verified by test: the same
   10 cm pattern lands in an identical band at 8, 14 and 20 m/s.
2. **Side-contrast log-ratios.** Both rails are measured in the same file at
   the same speed, so `log(side_I / side_II)` cancels speed, train and session
   effects exactly. This is what lets amplitude features contribute at all.
3. **Absolute amplitude and raw speed excluded by default**
   (`include_scale_features`, `include_speed_feature`).

The evaluator reports the speed-only baseline next to the model score on every
training run, so the margin over the confound stays visible.

## Why a per-side binary forest

`strategy: per_side` reshapes each file into **two rows, one per rail**, and
trains a binary "is this rail corrugated?" forest. Both per-rail probabilities
are then combined into the three-class label.

This matters because there are only **14 Side I files**. Asking one model to
learn Side I as its own class from 14 examples fails outright — the multiclass
benchmark never predicts Side I at all (F1 = 0.00). Pooling both sides gives
the same model **38 fault examples** of a single side-agnostic signature.

| Strategy | Macro F1 (OOF) | Side I F1 |
|---|---|---|
| `multiclass` (3-class, 272 rows) | 0.435 ± 0.021 | **0.00** |
| `per_side` (binary, 544 rows) | **0.72** | 0.35 |

## Why ExtraTrees rather than a RandomForest

Detection, not side attribution, is what limits this subsystem: of the errors a
RandomForest made, 32 were detection failures (24 false alarms, 8 misses) and
only 3 were the wrong side. So the forest itself was the thing worth changing.

The diagnosis is **variance, not bias**. A RandomForest reaches a *perfect*
training fit here (train AP = 1.000) and loses 0.36 average precision
out-of-fold. Growing the forest cannot fix that — `n_estimators` averages away
ensemble variance but adds no capacity, and 100 → 6000 trees moves AP by
+0.017. With 721 correlated spectral features and 38 positive rows, optimised
split points are free to chase noise; randomised thresholds are not.

| Detector (per-side, OOF, 6 repeats) | Avg precision | Macro F1 |
|---|---|---|
| RandomForest, `class_weight="balanced_subsample"` | 0.647 | 0.666 |
| ExtraTrees, same weighting | 0.724 | 0.703 |
| **ExtraTrees, `max_features=0.05`, weight 1:3** | **0.780** | **0.723** |

Two things carry that gain. ExtraTrees over RandomForest is most of it. The
rest is the class weight: `"balanced"` implies a **7.2x** minority weight here,
which buys recall at a precision cost macro F1 does not forgive — the OOF
optimum is a much milder 2-4x. Because ExtraTrees does not bootstrap,
`class_weight={0: 1, 1: 3}` is exactly equivalent to duplicating every fault
row three times, so oversampling is expressed as a weight rather than as
copied rows.

Synthetic minority augmentation was tried and **rejected**: jittered copies
(AP 0.772) and SMOTE-style interpolation (AP 0.765) both scored *below* plain
duplication (AP 0.790). Interpolating in a 721-dimensional feature space
invents points the physics does not produce.

Net effect on the confusion matrix: false alarms fall **24 -> 8** out of 234
normal files, at a cost of 2 missed faults (30 -> 28 of 38 detected).

## Validation design

`StratifiedGroupKFold`, **grouped by source file** and **stratified by label**,
repeated over 4 seeds.

- *Grouped* because the two rows of one file share `contrast__*` features by
  construction; splitting them across the fold boundary would leak.
- *Stratified* because with 14 Side I files an unstratified fold could contain
  none, making its macro F1 meaningless.
- *Repeated* because at this sample size the fold assignment moves the score
  more than most modelling choices do.

The decision threshold is tuned on out-of-fold predictions (best mean across
repeats, not the best single fold). Note this is mildly optimistic — the
threshold sees all the OOF data — so the score at a fixed 0.5 threshold is
reported alongside it.

## Explainability

`RailForestModel` carries a SHAP `TreeExplainer` (exact for tree ensembles):

- `global_importance(X)` — mean |SHAP| per feature, and per feature family
- `explain_instance(X, row)` — signed per-feature attribution for one rail,
  for the app's explanation panel

Because features are named `contrast__vib__wlfrac2__mean`, an attribution reads
directly as physics: *"this rail carries more 8–16 cm wavelength energy than
the opposite rail."*

## Output format

`rail_predictions.csv`, one row per input file (Info Kit §3):

```csv
file_id,prediction
Test1.csv,Normal
Test2.csv,Side II
```

`--with-scores` additionally writes per-rail probabilities for inspection.

## Known limitations

- **Side I remains the weak class** (F1 ≈ 0.35). 14 training examples is very
  few, and their side-contrast signal is genuinely weaker than Side II's
  (median RMS ratio 1.08 vs 0.82).
- **Stationary recordings** are forced to `Normal`. With the train at rest
  there is no wheel-rail excitation, so corrugation cannot appear in the
  signal; this is a physical limit, not a modelling choice.
- The tuned threshold is fitted on OOF data — see Validation design above.
