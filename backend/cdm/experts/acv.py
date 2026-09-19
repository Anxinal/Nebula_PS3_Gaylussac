"""ACV expert: locating a refrigerant leak to a specific car.

Task (ACV_Subsystem_Info_Kit §3): rank all 8 cars from most to least likely to
hold the leak. Scored by linear rank decay, ``(n - (r - 1)) / n``.

The physics is direct. Refrigerant undercharge means lost cooling capacity, so
the affected car cannot pull its cabin down to the commanded setpoint and runs
warmer than its siblings - which are travelling the same route, in the same
weather, under the same control logic at the same moment. Every feature here
is therefore *relative to the fleet*: it is the car that stands out from the
other seven that matters, not its absolute temperature.

Schema handling
---------------
The Info Kit warns that the parameter set differs between files, and it does:
five of six training cases and the held-out test case carry 8 parameters per
car, while ``acv_case_04`` carries 63 under entirely different names. Rather
than dropping that case (a sixth of the training data), columns are resolved
through ``CANONICAL_PARAMETERS`` onto the handful of roles the model needs, so
both schemas train together. Note that case 04's richer telemetry includes
refrigeration-circuit pressures, which would diagnose a leak almost directly -
but they are absent from the test file, so they are deliberately not used.
"""

from __future__ import annotations

import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

from ..base import SubsystemExpert, Verdict
from ..explain import explain_prediction, physics_explanation

CAR_COLUMN_RE = re.compile(r"^Car (\S+) - (.+)$")

#: Canonical role -> the parameter names that fill it, most preferred first.
CANONICAL_PARAMETERS = {
    "indoor": ("Indoor Average Temperature", "Passenger Cabin Temperature Detected Value"),
    "outdoor": ("Outdoor Average Temperature", "Fresh Air Temperature Detected Value"),
    "setpoint": ("ACV Control Temperature (Cooling)", "Target Temperature Value"),
    "setpoint_heat": ("ACV Control Temperature (Heating)",),
    "running_mode": ("ACV Running Mode",),
}


def car_columns(frame: pd.DataFrame) -> dict[str, dict[str, str]]:
    """``{car_id: {parameter: column_name}}`` from the file's own headers."""
    mapping: dict[str, dict[str, str]] = {}
    for column in frame.columns:
        match = CAR_COLUMN_RE.match(str(column))
        if match:
            mapping.setdefault(match.group(1), {})[match.group(2)] = str(column)
    return mapping


def resolve(params: dict[str, str], role: str) -> str | None:
    for candidate in CANONICAL_PARAMETERS[role]:
        if candidate in params:
            return params[candidate]
    return None


def _series(frame: pd.DataFrame, params: dict[str, str], role: str) -> pd.Series | None:
    column = resolve(params, role)
    if column is None:
        return None
    return pd.to_numeric(frame[column], errors="coerce")


def case_features(path: str | Path) -> pd.DataFrame:
    """One row per car, with fleet-relative features."""
    frame = pd.read_excel(path)
    mapping = car_columns(frame)
    cars = sorted(mapping)

    indoor = {c: _series(frame, mapping[c], "indoor") for c in cars}
    setpoint = {c: _series(frame, mapping[c], "setpoint") for c in cars}
    outdoor = {c: _series(frame, mapping[c], "outdoor") for c in cars}
    mode = {c: _series(frame, mapping[c], "running_mode") for c in cars}

    rows = []
    for car in cars:
        temp = indoor[car]
        row: dict[str, float | str] = {"file_id": Path(path).name, "car": car}
        if temp is None or temp.notna().sum() == 0:
            rows.append(row | {k: 0.0 for k in
                               ("indoor_mean", "indoor_std", "indoor_max", "indoor_slope",
                                "shortfall_mean", "frac_above_setpoint", "outdoor_mean",
                                "mode_nunique", "mode_changes")})
            continue
        valid = temp.dropna()
        row["indoor_mean"] = float(valid.mean())
        row["indoor_std"] = float(valid.std()) if valid.size > 1 else 0.0
        row["indoor_max"] = float(valid.max())
        # Drift over the run: a leaking car loses capacity progressively.
        row["indoor_slope"] = (
            float(np.polyfit(np.arange(valid.size), valid.to_numpy(), 1)[0]) if valid.size > 2 else 0.0
        )
        sp = setpoint[car]
        if sp is not None and sp.notna().sum():
            gap = (temp - sp).dropna()
            row["shortfall_mean"] = float(gap.mean())
            row["frac_above_setpoint"] = float((gap > 0).mean())
        else:
            row["shortfall_mean"] = 0.0
            row["frac_above_setpoint"] = 0.0
        row["outdoor_mean"] = float(outdoor[car].dropna().mean()) if outdoor[car] is not None and outdoor[car].notna().sum() else 0.0
        m = mode[car]
        row["mode_nunique"] = float(m.nunique()) if m is not None else 0.0
        row["mode_changes"] = float((m.diff() != 0).sum()) if m is not None else 0.0
        rows.append(row)

    table = pd.DataFrame(rows)

    # Fleet-relative view: the whole task is picking the outlier car, so every
    # absolute quantity is re-expressed against what the other seven cars did.
    for column in ("indoor_mean", "indoor_max", "indoor_slope", "shortfall_mean",
                   "frac_above_setpoint", "indoor_std"):
        values = table[column].to_numpy(float)
        median = float(np.median(values))
        spread = float(np.median(np.abs(values - median))) + 1e-9
        table[f"dev_{column}"] = values - median
        table[f"z_{column}"] = (values - median) / spread
        table[f"rank_{column}"] = table[column].rank(ascending=False, method="min")
    return table


FEATURE_COLUMNS = [
    "indoor_mean", "indoor_std", "indoor_max", "indoor_slope", "shortfall_mean",
    "frac_above_setpoint", "mode_nunique", "mode_changes",
    "dev_indoor_mean", "z_indoor_mean", "rank_indoor_mean",
    "dev_indoor_max", "z_indoor_max", "rank_indoor_max",
    "dev_indoor_slope", "z_indoor_slope", "rank_indoor_slope",
    "dev_shortfall_mean", "z_shortfall_mean", "rank_shortfall_mean",
    "dev_frac_above_setpoint", "z_frac_above_setpoint", "rank_frac_above_setpoint",
    "dev_indoor_std", "z_indoor_std", "rank_indoor_std",
]


def rank_decay_score(ranked_cars: list[str], true_car: str) -> float:
    """Info Kit §4: ``(n - (r - 1)) / n``, and 0 if the car is absent."""
    n = len(ranked_cars)
    if n == 0 or true_car not in ranked_cars:
        return 0.0
    r = ranked_cars.index(true_car) + 1
    return (n - (r - 1)) / n


class ACVExpert(SubsystemExpert):
    name = "acv"
    submission_filename = "acv_predictions.csv"

    def __init__(self, data_root: str | Path | None = None, n_estimators: int = 500, random_state: int = 42):
        from ..paths import DATASETS_ROOT

        self.data_root = Path(data_root) if data_root else DATASETS_ROOT / "ACV"
        self.model = RandomForestClassifier(
            n_estimators=n_estimators, max_depth=4, min_samples_leaf=2,
            class_weight="balanced", random_state=random_state, n_jobs=-1,
        )
        self.feature_names = list(FEATURE_COLUMNS)
        self.cv_metric = "linear rank-decay"
        self.baselines: dict[str, float] = {}
        #: Falls back to the physics ranking when the forest cannot beat it.
        self.use_physics_only = False

    # -- data ---------------------------------------------------------------
    def _training_table(self) -> pd.DataFrame:
        labels = pd.read_csv(self.data_root / "Train_Labels.csv", dtype=str)
        frames = []
        for _, row in labels.iterrows():
            table = case_features(self.data_root / "Train" / row.filename)
            table["target"] = (table.car == row.faulty_car).astype(int)
            frames.append(table)
        return pd.concat(frames, ignore_index=True)

    @staticmethod
    def _physics_rank(table: pd.DataFrame) -> list[str]:
        """Rank by cooling shortfall relative to the fleet, then by warmth."""
        ordered = table.sort_values(
            ["dev_shortfall_mean", "dev_indoor_mean"], ascending=False
        )
        return list(ordered.car)

    # -- training -----------------------------------------------------------
    def fit(self, *, verbose: bool = True) -> "ACVExpert":
        table = self._training_table()
        labels = pd.read_csv(self.data_root / "Train_Labels.csv", dtype=str)
        truth = dict(zip(labels.filename, labels.faulty_car))

        # Only 6 labelled cases exist, so leave-one-case-out is the only
        # validation with any power - and even then each fold trains on 5.
        forest_scores, physics_scores = [], []
        for held_out in labels.filename:
            train = table[table.file_id != held_out]
            test = table[table.file_id == held_out].copy()

            model = RandomForestClassifier(**self.model.get_params())
            model.fit(train[self.feature_names].to_numpy(float), train.target.to_numpy())
            test["p"] = model.predict_proba(test[self.feature_names].to_numpy(float))[:, 1]
            ranked = list(test.sort_values("p", ascending=False).car)
            forest_scores.append(rank_decay_score(ranked, truth[held_out]))
            physics_scores.append(rank_decay_score(self._physics_rank(test), truth[held_out]))

        self.baselines = {
            "forest_leave_one_case_out": float(np.mean(forest_scores)),
            "physics_ranking": float(np.mean(physics_scores)),
        }
        # With six cases, a learned model that cannot beat the physical
        # ordering is not worth its variance on a held-out case.
        self.use_physics_only = self.baselines["physics_ranking"] > self.baselines["forest_leave_one_case_out"]
        self.cv_score = max(self.baselines.values())

        if verbose:
            for name, value in self.baselines.items():
                mark = ""
                if (name == "physics_ranking") == self.use_physics_only:
                    mark = "  <- used"
                print(f"  ACV {name:26s}: {value:.4f}{mark}")
            print(f"  ACV per-case forest scores : {[round(s,3) for s in forest_scores]}")
            print(f"  ACV per-case physics scores: {[round(s,3) for s in physics_scores]}")

        self.model.fit(table[self.feature_names].to_numpy(float), table.target.to_numpy())
        return self

    # -- inference ----------------------------------------------------------
    def _rank_case(self, path: str | Path) -> pd.DataFrame:
        table = case_features(path)
        if self.use_physics_only:
            order = self._physics_rank(table)
            table["score"] = [len(order) - order.index(c) for c in table.car]
        else:
            table["score"] = self.model.predict_proba(
                table[self.feature_names].to_numpy(float)
            )[:, 1]
        return table.sort_values("score", ascending=False).reset_index(drop=True)

    def predict_file(self, path: str | Path) -> Verdict:
        ranked = self._rank_case(path)
        top = ranked.iloc[0]

        if self.use_physics_only:
            # No forest was consulted, so there is no decision path to walk.
            # Report the physical quantities that drove the ranking instead of
            # dressing an empty tree decomposition up as an explanation.
            explanation = physics_explanation(
                {
                    "dev_shortfall_mean_K": float(top.dev_shortfall_mean),
                    "dev_indoor_mean_K": float(top.dev_indoor_mean),
                },
                "ranked by physics, not by the forest: cooling shortfall relative to the fleet",
            )
        else:
            explanation = explain_prediction(
                self.model,
                ranked.iloc[0][self.feature_names].to_numpy(dtype=float),
                list(self.feature_names),
                units_note=f"P(car {top.car} is the leaking car)",
            )

        return Verdict(
            subsystem=self.name,
            fault_detected=None,  # localisation task: a leak is present by construction
            summary=f"most likely leaking car: {top.car} "
                    f"(runs {top.dev_indoor_mean:+.2f} K against the fleet median)",
            detail={"ranked_cars": list(ranked.car),
                    "deviation_K": dict(zip(ranked.car, ranked.dev_indoor_mean.round(3)))},
            confidence=float(top.score) if not self.use_physics_only else None,
            explanation=explanation,
        )

    def submission_rows(self, paths: list[Path]) -> pd.DataFrame:
        rows = []
        for path in paths:
            ranked = self._rank_case(path)
            rows.append({"file_id": Path(path).name, "ranked_cars": "|".join(ranked.car)})
        return pd.DataFrame(rows)

    def save(self, path: str | Path) -> Path:
        path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": self.model, "features": self.feature_names,
                     "cv_score": self.cv_score, "baselines": self.baselines,
                     "use_physics_only": self.use_physics_only,
                     "data_root": str(self.data_root)}, path, compress=3)
        return path

    @classmethod
    def load(cls, path: str | Path) -> "ACVExpert":
        blob = joblib.load(Path(path))
        expert = cls(data_root=blob["data_root"])
        expert.model = blob["model"]; expert.feature_names = blob["features"]
        expert.cv_score = blob["cv_score"]; expert.baselines = blob.get("baselines", {})
        expert.use_physics_only = blob.get("use_physics_only", False)
        return expert
