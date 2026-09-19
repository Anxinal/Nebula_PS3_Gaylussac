"""Door expert: temporal segment detection plus abnormal-resistance classification.

Task (Door_Subsystem_Info_Kit §3): given a continuous controller stream, find
each door-open/close cycle and label it ``Normal`` or ``Abnormal resistance``.
Scored on IoU-weighted F1 (§4).

Segmentation
------------
The Info Kit warns against assuming the opening/closing flags mark cycle
boundaries, and it is right to: those flags are asserted across the *entire*
stream and yield one run, not 110. What actually separates cycles is the
**sampling gap**. Within a cycle the controller logs every 20 ms; between
cycles the train is standing with the doors idle and nothing is logged at all,
leaving gaps of 20-47 s. Splitting on gaps greater than 1 s recovers all 110
training cycles with **IoU = 1.000 against the ground truth**, row counts
matching exactly.

That matters for the metric: with segmentation exact and predicted segments
non-overlapping, every correctly-labelled segment matches its counterpart at
IoU 1 and every mislabelled one matches nothing, so the IoU-weighted F1
collapses to plain segment accuracy. The modelling problem is therefore purely
the Normal/Abnormal call.

Classification
--------------
Abnormal resistance means the door leaf is being obstructed, so the motor must
draw more current to keep moving - borne out by the training data (mean
current 720 mA abnormal vs 538 mA normal). Features are built around that:
current statistics, current per unit of leaf travel (work against resistance),
current relative to back-EMF (which tracks motor speed, so the ratio is a
torque-per-speed proxy), and a phase profile that locates *where* in the
stroke the extra effort occurs.
"""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold

from ..base import SubsystemExpert, Verdict
from ..explain import explain_prediction

NORMAL = "Normal"
ABNORMAL = "Abnormal resistance"

#: A cycle is a contiguous run of 20 ms samples; anything longer is the train
#: sitting idle between cycles.
GAP_SECONDS = 1.0

#: Number of equal-time slices used to profile where in the stroke effort peaks.
N_PHASES = 8

CURRENT = "Motor current(mA)"
VOLTAGE = "Motor Voltage(10mV)"
BACK_EMF = "Motor electrodynamic force"
POSITION = "Door leaf position"


def parse_datetime(value: str) -> pd.Timestamp:
    """Parse the dataset's ``Y-M-D-H-M-S-ms`` stamps (not zero padded)."""
    parts = [int(p) for p in str(value).split("-")]
    return pd.Timestamp(
        year=parts[0], month=parts[1], day=parts[2],
        hour=parts[3], minute=parts[4], second=parts[5],
        microsecond=parts[6] * 1000,
    )


def format_datetime(ts: pd.Timestamp) -> str:
    """Render back into the dataset's native format."""
    return (f"{ts.year}-{ts.month}-{ts.day}-{ts.hour}-{ts.minute}-{ts.second}"
            f"-{int(ts.microsecond / 1000)}")


def load_stream(path: str | Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame["_t"] = [parse_datetime(v) for v in frame["Datetime"]]
    return frame


def segment_stream(frame: pd.DataFrame, gap_seconds: float = GAP_SECONDS) -> list[tuple[int, int]]:
    """Split the stream into cycles on sampling gaps. Returns ``[start, end)`` pairs."""
    gaps = frame["_t"].diff().dt.total_seconds().fillna(0.0).to_numpy()
    starts = np.r_[0, np.flatnonzero(gaps > gap_seconds)]
    ends = np.r_[starts[1:], len(frame)]
    return [(int(a), int(b)) for a, b in zip(starts, ends) if b > a]


def segment_features(block: pd.DataFrame) -> dict[str, float]:
    """Descriptors for one door cycle."""
    current = block[CURRENT].to_numpy(float)
    voltage = block[VOLTAGE].to_numpy(float)
    emf = block[BACK_EMF].to_numpy(float)
    position = block[POSITION].to_numpy(float)
    n = max(len(block), 1)

    travel = float(np.abs(np.diff(position)).sum()) if len(position) > 1 else 0.0
    duration_s = float((block["_t"].iloc[-1] - block["_t"].iloc[0]).total_seconds())

    feats: dict[str, float] = {
        "n_rows": float(n),
        "duration_s": duration_s,
        "cur_mean": float(current.mean()),
        "cur_max": float(current.max()),
        "cur_std": float(current.std()),
        "cur_p75": float(np.percentile(current, 75)),
        "cur_p90": float(np.percentile(current, 90)),
        "cur_median": float(np.median(current)),
        # Total charge drawn - the work the motor had to do over the stroke.
        "cur_integral": float(current.sum()),
        "volt_mean": float(voltage.mean()),
        "emf_mean": float(emf.mean()),
        "emf_max": float(emf.max()),
        "pos_range": float(position.max() - position.min()),
        "pos_travel": travel,
        "pos_start": float(position[0]),
        "pos_end": float(position[-1]),
    }
    # Current per unit of leaf travel: the direct "effort against resistance"
    # measure, insensitive to how far the door happened to move.
    feats["cur_per_travel"] = feats["cur_integral"] / (travel + 1e-6)
    # Back-EMF tracks motor speed, so current/EMF is torque per unit speed -
    # it rises when the motor is fighting something.
    feats["cur_over_emf"] = feats["cur_mean"] / (feats["emf_mean"] + 1e-6)
    feats["cur_over_volt"] = feats["cur_mean"] / (feats["volt_mean"] + 1e-6)
    feats["speed_mean"] = travel / (duration_s + 1e-6)

    # Where in the stroke the effort sits - an obstruction bites at a
    # particular point rather than uniformly.
    edges = np.linspace(0, n, N_PHASES + 1).astype(int)
    for i in range(N_PHASES):
        lo, hi = edges[i], max(edges[i + 1], edges[i] + 1)
        feats[f"cur_phase{i}"] = float(current[lo:hi].mean())
    phase_values = np.array([feats[f"cur_phase{i}"] for i in range(N_PHASES)])
    feats["cur_phase_argmax"] = float(np.argmax(phase_values))
    feats["cur_phase_spread"] = float(phase_values.std())
    return feats


# --------------------------------------------------------------------------
def iou_weighted_f1(
    truth: list[tuple[pd.Timestamp, pd.Timestamp, str]],
    predicted: list[tuple[pd.Timestamp, pd.Timestamp, str]],
) -> float:
    """The Info Kit's §4.2 metric, implemented exactly as specified."""
    def iou(a, b, c, d) -> float:
        lo, hi = max(a.value, c.value), min(b.value, d.value)
        intersection = max(0, hi - lo)
        union = (b.value - a.value) + (d.value - c.value) - intersection
        return intersection / union if union > 0 else 0.0

    candidates = []
    for i, (ts, te, tl) in enumerate(truth):
        for j, (ps, pe, pl) in enumerate(predicted):
            if tl != pl:        # a wrong label cannot match at all
                continue
            value = iou(ts, te, ps, pe)
            if value > 0:
                candidates.append((value, i, j))

    # Greedy one-to-one assignment, best overlap first.
    candidates.sort(reverse=True)
    used_true: set[int] = set()
    used_pred: set[int] = set()
    total = 0.0
    for value, i, j in candidates:
        if i in used_true or j in used_pred:
            continue
        used_true.add(i); used_pred.add(j); total += value

    if not truth or not predicted:
        return 0.0
    recall = total / len(truth)
    precision = total / len(predicted)
    return 0.0 if (recall + precision) == 0 else 2 * recall * precision / (recall + precision)


class DoorExpert(SubsystemExpert):
    name = "door"
    submission_filename = "door_predictions.csv"

    def __init__(self, data_root: str | Path | None = None, n_estimators: int = 800, random_state: int = 42):
        from ..paths import DATASETS_ROOT

        self.data_root = Path(data_root) if data_root else DATASETS_ROOT / "Door"
        self.model = RandomForestClassifier(
            n_estimators=n_estimators, min_samples_leaf=1, max_features="sqrt",
            class_weight="balanced_subsample", random_state=random_state, n_jobs=-1,
        )
        self.feature_names: list[str] = []
        self.threshold: float = 0.5
        self.cv_metric = "IoU-weighted F1"
        self.segmentation_iou: float | None = None

    # -- data ---------------------------------------------------------------
    def _training_segments(self) -> tuple[pd.DataFrame, np.ndarray, list]:
        stream = load_stream(self.data_root / "Train.csv")
        answer = pd.read_csv(self.data_root / "Train_Segments_Answer.csv")
        answer["_s"] = [parse_datetime(v) for v in answer.start_time]
        answer["_e"] = [parse_datetime(v) for v in answer.end_time]

        bounds = segment_stream(stream)
        rows, spans = [], []
        for a, b in bounds:
            block = stream.iloc[a:b]
            rows.append(segment_features(block))
            spans.append((block["_t"].iloc[0], block["_t"].iloc[-1]))

        # Attach each detected cycle to the ground-truth cycle it overlaps.
        labels, ious = [], []
        for (ps, pe) in spans:
            best, best_iou = NORMAL, 0.0
            for _, r in answer.iterrows():
                lo, hi = max(ps.value, r._s.value), min(pe.value, r._e.value)
                inter = max(0, hi - lo)
                union = (pe.value - ps.value) + (r._e.value - r._s.value) - inter
                value = inter / union if union > 0 else 0.0
                if value > best_iou:
                    best, best_iou = r.status, value
            labels.append(best); ious.append(best_iou)
        self.segmentation_iou = float(np.mean(ious))
        return pd.DataFrame(rows), np.asarray(labels), spans

    # -- training -----------------------------------------------------------
    def fit(self, *, verbose: bool = True) -> "DoorExpert":
        frame, labels, spans = self._training_segments()
        self.feature_names = list(frame.columns)
        X = frame.to_numpy(float)
        y = (labels == ABNORMAL).astype(int)

        truth = [(s, e, l) for (s, e), l in zip(spans, labels)]

        # Nested threshold selection: the cut is chosen inside each training
        # fold and then applied to the held-out fold, so the reported score is
        # never credited for a threshold fitted on the data it is scored on.
        # (Tuning globally on the out-of-fold probabilities reports a perfect
        # 1.0000 here, which is exactly the flattery this avoids.)
        grid = np.arange(0.10, 0.91, 0.02)
        oof = np.zeros(len(y))
        oof_label = np.empty(len(y), dtype=object)
        chosen: list[float] = []

        for train_idx, test_idx in StratifiedKFold(5, shuffle=True, random_state=0).split(X, y):
            fold = RandomForestClassifier(**self.model.get_params())
            fold.fit(X[train_idx], y[train_idx])
            oof[test_idx] = fold.predict_proba(X[test_idx])[:, 1]

            inner = np.zeros(len(train_idx))
            for a, b in StratifiedKFold(4, shuffle=True, random_state=1).split(X[train_idx], y[train_idx]):
                deep = RandomForestClassifier(**self.model.get_params())
                deep.fit(X[train_idx][a], y[train_idx][a])
                inner[b] = deep.predict_proba(X[train_idx][b])[:, 1]
            inner_truth = [(s_, e_, l_) for (s_, e_), l_ in
                           zip([spans[i] for i in train_idx], labels[train_idx])]
            best_t, best_s = 0.5, -1.0
            for t in grid:
                pred = [(s_, e_, ABNORMAL if pr >= t else NORMAL)
                        for (s_, e_), pr in zip([spans[i] for i in train_idx], inner)]
                sc = iou_weighted_f1(inner_truth, pred)
                if sc > best_s:
                    best_t, best_s = float(t), sc
            chosen.append(best_t)
            oof_label[test_idx] = np.where(oof[test_idx] >= best_t, ABNORMAL, NORMAL)

        truth_all = [(s_, e_, l_) for (s_, e_), l_ in zip(spans, labels)]
        self.cv_score = iou_weighted_f1(
            truth_all, [(s_, e_, l_) for (s_, e_), l_ in zip(spans, oof_label)]
        )
        self.threshold = float(np.median(chosen))

        if verbose:
            all_normal = iou_weighted_f1(truth_all, [(s_, e_, NORMAL) for s_, e_ in spans])
            accuracy = float((oof_label == labels).mean())
            optimistic = max(
                iou_weighted_f1(truth_all,
                                [(s_, e_, ABNORMAL if pr >= t else NORMAL)
                                 for (s_, e_), pr in zip(spans, oof)])
                for t in grid
            )
            print(f"  Door segmentation : {len(spans)} cycles, mean IoU {self.segmentation_iou:.4f}")
            print(f"  Door all-Normal   : score {all_normal:.4f}  (baseline)")
            print(f"  Door forest       : score {self.cv_score:.4f}  "
                  f"(nested threshold {self.threshold:.2f}, accuracy {accuracy:.4f})")
            print(f"    for reference, tuning the threshold on the OOF data itself "
                  f"would report {optimistic:.4f}")

        self.model.fit(X, y)
        return self

    # -- inference ----------------------------------------------------------
    def _predict_segments(self, path: str | Path, *, return_features: bool = False):
        stream = load_stream(path)
        bounds = segment_stream(stream)
        rows, spans = [], []
        for a, b in bounds:
            block = stream.iloc[a:b]
            rows.append(segment_features(block))
            spans.append((block["_t"].iloc[0], block["_t"].iloc[-1]))
        features = pd.DataFrame(rows)
        X = features[self.feature_names].to_numpy(float)
        proba = self.model.predict_proba(X)[:, 1]
        segments = pd.DataFrame({
            "start_time": [format_datetime(s) for s, _ in spans],
            "end_time": [format_datetime(e) for _, e in spans],
            "prediction": np.where(proba >= self.threshold, ABNORMAL, NORMAL),
            "confidence": proba,
        })
        return (segments, features) if return_features else segments

    def predict_file(self, path: str | Path) -> Verdict:
        segments, features = self._predict_segments(path, return_features=True)
        n_abnormal = int((segments.prediction == ABNORMAL).sum())

        explanation = None
        if len(segments):
            # A stream holds many cycles, so explain the one that carries the
            # verdict: the most suspicious cycle. That is the segment a
            # maintainer would actually go and look at.
            row = int(segments.confidence.to_numpy().argmax())
            explanation = explain_prediction(
                self.model,
                features.iloc[row][self.feature_names].to_numpy(dtype=float),
                list(self.feature_names),
                extra_terms={"segment_index": float(row),
                             "segment_confidence": float(segments.confidence.iloc[row])},
                units_note=f"P(abnormal resistance) for the cycle starting {segments.start_time.iloc[row]}",
            )

        return Verdict(
            subsystem=self.name,
            fault_detected=n_abnormal > 0,
            summary=f"{len(segments)} door cycles found, {n_abnormal} showing abnormal resistance",
            detail={"n_segments": len(segments), "n_abnormal": n_abnormal,
                    "segments": segments.to_dict("records")},
            confidence=float(segments.confidence.max()) if len(segments) else None,
            explanation=explanation,
        )

    def web_payload(self, paths: list[Path]) -> dict:
        """Response body for ``POST /predict/door`` (see frontend/README.md).

        Door's stream is scored as a whole, so multiple uploads are concatenated
        into one segment list, which is what the submission format expects too.
        """
        segments_out: list[dict] = []
        trace: list[dict] = []
        total_rows = 0
        duration = 0.0
        file_explanation = None

        for path in paths:
            stream = load_stream(path)
            segments, features = self._predict_segments(path, return_features=True)
            origin = stream["_t"].iloc[0]
            total_rows += len(stream)
            duration += float((stream["_t"].iloc[-1] - origin).total_seconds())

            bounds = segment_stream(stream)
            for i, ((a, b), row) in enumerate(zip(bounds, segments.itertuples())):
                block = stream.iloc[a:b]
                position = block[POSITION].to_numpy(float)
                # Leaf position rising over the cycle means the door opened:
                # verified against all 110 labelled training segments.
                operation = "Open" if position[-1] > position[0] else "Close"
                explanation = explain_prediction(
                    self.model,
                    features.iloc[i][self.feature_names].to_numpy(dtype=float),
                    list(self.feature_names),
                    include_shap=False,  # per-segment: node walk only, keeps it fast
                )
                segments_out.append({
                    "start_time": row.start_time,
                    "end_time": row.end_time,
                    "prediction": row.prediction,
                    "operation": operation,
                    "mean_current": float(features.iloc[i]["cur_mean"]),
                    # Signed distance from the decision threshold; > 0 = abnormal.
                    "margin": float(row.confidence - self.threshold),
                    "n_rows": int(b - a),
                    "start_offset_sec": float((block["_t"].iloc[0] - origin).total_seconds()),
                    "end_offset_sec": float((block["_t"].iloc[-1] - origin).total_seconds()),
                    "confidence": float(row.confidence),
                    "explanation": explanation.to_dict(4),
                })

            # Downsampled current trace for the overview chart.
            step = max(1, len(stream) // 1500)
            sampled = stream.iloc[::step]
            trace += [
                {"t": float((t - origin).total_seconds()), "current": float(c)}
                for t, c in zip(sampled["_t"], sampled[CURRENT])
            ]
            if file_explanation is None:
                file_explanation = self.predict_file(path).explanation

        n_abnormal = sum(1 for s in segments_out if s["prediction"] == ABNORMAL)
        return {
            "segments": segments_out,
            "trace": trace,
            "total_rows": total_rows,
            "duration_sec": duration,
            "summary": f"{len(segments_out)} door cycles found, {n_abnormal} showing abnormal resistance",
            "explanation": file_explanation.to_dict() if file_explanation else None,
        }

    def submission_rows(self, paths: list[Path]) -> pd.DataFrame:
        # Door's submission is per predicted segment across the stream, with
        # no file_id column (Info Kit §3).
        frames = [self._predict_segments(p) for p in paths]
        out = pd.concat(frames, ignore_index=True)
        return out[["start_time", "end_time", "prediction"]]

    def save(self, path: str | Path) -> Path:
        path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": self.model, "features": self.feature_names,
                     "threshold": self.threshold, "cv_score": self.cv_score,
                     "segmentation_iou": self.segmentation_iou,
                     "data_root": str(self.data_root)}, path, compress=3)
        return path

    @classmethod
    def load(cls, path: str | Path) -> "DoorExpert":
        blob = joblib.load(Path(path))
        expert = cls(data_root=blob["data_root"])
        expert.model = blob["model"]; expert.feature_names = blob["features"]
        expert.threshold = blob["threshold"]; expert.cv_score = blob["cv_score"]
        expert.segmentation_iou = blob.get("segmentation_iou")
        return expert
