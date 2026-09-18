"""Rail corrugation expert - adapter over the existing ``rail_cdm`` package.

The rail pipeline predates the hierarchical stack and is documented in
``backend/README.md``: a per-side binary Random Forest over wavelength-domain
and side-contrast features, combined into the three-class label. This module
only wraps it in the common ``SubsystemExpert`` interface so the router can
dispatch to it like any other subsystem.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from rail_cdm.config import CLASS_NORMAL, PipelineConfig
from rail_cdm.dataloader import RailDataLoader
from rail_cdm.model import RailForestModel
from rail_cdm.trainer import RailTrainer

from ..base import SubsystemExpert, Verdict


class RailExpert(SubsystemExpert):
    name = "rail"
    submission_filename = "rail_predictions.csv"

    def __init__(self, config: PipelineConfig | None = None):
        self.config = config or PipelineConfig()
        self.loader = RailDataLoader(self.config)
        self.model: RailForestModel | None = None
        self.cv_metric = "macro F1"
        self.baselines: dict[str, float] = {}

    def fit(self, *, verbose: bool = True) -> "RailExpert":
        file_frame = self.loader.build_file_frame("train")
        side_frame = self.loader.to_side_frame(file_frame)
        X = side_frame[self.loader.feature_columns(side_frame)]

        trainer = RailTrainer(self.config.model, self.config.cv)
        report = trainer.cross_validate_per_side(X, side_frame, file_frame)
        self.cv_score = report.macro_f1_mean

        from rail_cdm.evaluator import RailEvaluator

        baseline = RailEvaluator().speed_only_baseline(file_frame.label, file_frame.speed_ms)
        self.baselines = {"speed_only": baseline["macro_f1"], "always_normal": 0.3083}

        if verbose:
            print(f"  Rail per-side forest : macro F1 {self.cv_score:.4f} "
                  f"+/- {report.macro_f1_std:.4f} (threshold {report.threshold:.2f})")
            print(f"  Rail speed-only floor: {baseline['macro_f1']:.4f}  "
                  f"(margin {self.cv_score - baseline['macro_f1']:+.4f})")

        self.model = trainer.fit_final(X, side_frame, report.threshold)
        return self

    # -- inference ---------------------------------------------------------
    def _predict_frame(self, paths: list[Path]) -> pd.DataFrame:
        if self.model is None:
            raise RuntimeError("rail expert is not fitted")
        rows = [self.loader.extract_file_features(p) for p in paths]
        file_frame = pd.DataFrame(rows)
        file_frame["label"] = pd.NA
        side_frame = self.loader.to_side_frame(file_frame)
        X = side_frame[self.model.feature_names]
        return self.model.predict_file_labels(side_frame, X)

    def predict_file(self, path: str | Path) -> Verdict:
        result = self._predict_frame([Path(path)]).iloc[0]
        label = str(result.prediction)
        return Verdict(
            subsystem=self.name,
            fault_detected=label != CLASS_NORMAL,
            summary=(f"{label} rail condition" if label == CLASS_NORMAL
                     else f"corrugation detected on the {label} rail"),
            detail={"prediction": label,
                    "p_side_I": float(result.p_side_I),
                    "p_side_II": float(result.p_side_II),
                    "is_stationary": bool(result.is_stationary)},
            confidence=float(result.confidence),
        )

    def submission_rows(self, paths: list[Path]) -> pd.DataFrame:
        return self._predict_frame(list(paths))[["file_id", "prediction"]]

    def save(self, path: str | Path) -> Path:
        if self.model is None:
            raise RuntimeError("rail expert is not fitted")
        return self.model.save(path)

    @classmethod
    def load(cls, path: str | Path) -> "RailExpert":
        expert = cls()
        expert.model = RailForestModel.load(path)
        return expert
