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
| **Rail** | 3-class | macro F1 | per-side binary RF | **0.6634** |

**Overall Score (÷4) = 0.8972.** All scores are cross-validated on training
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
data `log(damage)` tracks `log(S₅)` at **r = 0.9971**. That matters: a plain
forest over all features scores 0.907, *worse* than a one-feature linear fit
on the physics at 0.940, because a forest adds variance to what is nearly an
exact power law. The expert therefore anchors on the linear Miner's term and
puts the forest on the **residual** — 0.946.

**Rail — `cdm/experts/rail.py`.** Adapter over the `rail_cdm` package; the
deep-dive below is unchanged.

## Caveats

- **Door's 1.0000 is on 110 training segments** and survives nested threshold
  selection across 8 seeds, but the classes are very nearly linearly
  separable, which suggests cleanly-injected faults. Do not expect 1.0 held out.
- **ACV has 6 labelled cases.** Leave-one-case-out over 6 is extremely noisy;
  0.9792 means "5 firsts and one second", and a single held-out case could
  move it a lot. The physics-only ranking (0.8958) is the safer fallback and
  is retained in the code.
- **SHM assumes a single effective S-N exponent** across two lines and two
  load conditions. The residual forest absorbs some of that, but a held-out
  file from an unrepresented condition could sit outside the fitted range —
  and forests cannot extrapolate.
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
| `rail_cdm/model.py` | `RandomForestClassifier` + SHAP `TreeExplainer`, side-probability combination, persistence |
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
| `per_side` (binary, 544 rows) | **0.66** | 0.35 |

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
