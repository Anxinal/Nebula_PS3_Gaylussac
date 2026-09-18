"""Cross-validation, threshold tuning and final fitting.

Validation design
-----------------
The split is **grouped by source file and stratified by that file's label**.

Grouping matters because the ``per_side`` strategy emits two rows per
recording that share ``contrast__*`` features by construction - if the Side I
row landed in train and the Side II row in test, the model would have already
seen most of the test row's information. ``StratifiedGroupKFold`` keeps both
rows of a file on the same side of every split.

Stratifying matters because there are only 14 Side I files; without it a fold
could easily contain none, making the macro F1 for that fold meaningless.

The whole cross-validation is repeated with different seeds, because with 38
fault files a single 5-fold run is noisy enough that the fold assignment moves
the score more than most modelling choices do.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from .config import CLASS_NORMAL, CLASS_ORDER, CLASS_SIDE_I, CLASS_SIDE_II, CVConfig, ModelConfig
from .evaluator import RailEvaluator
from .model import RailForestModel


@dataclass
class CVReport:
    """Everything the cross-validation learned."""

    strategy: str
    macro_f1_mean: float
    macro_f1_std: float
    macro_f1_per_repeat: list[float]
    threshold: float
    threshold_curve: pd.DataFrame = field(default_factory=pd.DataFrame)
    oof_predictions: pd.DataFrame = field(default_factory=pd.DataFrame)
    macro_f1_at_default: float = float("nan")

    def __str__(self) -> str:
        spread = ", ".join(f"{s:.3f}" for s in self.macro_f1_per_repeat)
        return (
            f"strategy            : {self.strategy}\n"
            f"macro F1 (OOF)      : {self.macro_f1_mean:.4f} +/- {self.macro_f1_std:.4f}\n"
            f"  per repeat        : [{spread}]\n"
            f"  at threshold 0.50 : {self.macro_f1_at_default:.4f}\n"
            f"tuned threshold     : {self.threshold:.2f}"
        )


class RailTrainer:
    """Runs repeated grouped CV, tunes the decision threshold, fits the final model."""

    def __init__(
        self,
        model_config: ModelConfig | None = None,
        cv_config: CVConfig | None = None,
    ):
        self.model_config = model_config or ModelConfig()
        self.cv_config = cv_config or CVConfig()
        self.evaluator = RailEvaluator()

    # -- per-side strategy -------------------------------------------------
    def _oof_side_probabilities(
        self, X: pd.DataFrame, side_frame: pd.DataFrame, seed: int
    ) -> np.ndarray:
        """One out-of-fold P(corrugated) per side-row."""
        groups = side_frame["file_id"].to_numpy()
        stratify = side_frame["label"].to_numpy()  # file-level class, repeated per row
        y = side_frame["target"].to_numpy()

        oof = np.full(len(side_frame), np.nan)
        splitter = StratifiedGroupKFold(
            n_splits=self.cv_config.n_splits, shuffle=True, random_state=seed
        )
        for train_idx, test_idx in splitter.split(X, stratify, groups=groups):
            model = RailForestModel(self.model_config)
            model.fit(X.iloc[train_idx], y[train_idx])
            oof[test_idx] = model.fault_probability(X.iloc[test_idx])
        if np.isnan(oof).any():
            raise RuntimeError("some rows never appeared in a test fold")
        return oof

    @staticmethod
    def _labels_from_side_probs(
        side_frame: pd.DataFrame, probs: np.ndarray, threshold: float, *, stationary_override: bool = True
    ) -> pd.DataFrame:
        scored = side_frame[["file_id", "side", "is_stationary"]].copy()
        scored["p"] = probs
        wide = scored.pivot(index="file_id", columns="side", values="p")
        stationary = scored.groupby("file_id")["is_stationary"].max()

        p_i, p_ii = wide["I"].to_numpy(), wide["II"].to_numpy()
        best = np.maximum(p_i, p_ii)
        labels = np.where(
            best < threshold,
            CLASS_NORMAL,
            np.where(p_i >= p_ii, CLASS_SIDE_I, CLASS_SIDE_II),
        )
        if stationary_override:
            labels = np.where(stationary.to_numpy() > 0, CLASS_NORMAL, labels)
        return pd.DataFrame(
            {"file_id": wide.index, "prediction": labels,
             "p_side_I": p_i, "p_side_II": p_ii}
        ).reset_index(drop=True)

    def cross_validate_per_side(
        self, X: pd.DataFrame, side_frame: pd.DataFrame, file_frame: pd.DataFrame
    ) -> CVReport:
        truth = file_frame.set_index("file_id")["label"]

        repeat_probs: list[np.ndarray] = []
        for repeat in range(self.cv_config.n_repeats):
            repeat_probs.append(
                self._oof_side_probabilities(
                    X, side_frame, seed=self.cv_config.random_state + 1000 * repeat
                )
            )

        # Score every threshold on every repeat, then pick the threshold with
        # the best mean - rather than the best single lucky fold assignment.
        grid = list(self.cv_config.threshold_grid) if self.cv_config.tune_threshold else [0.5]
        curve_rows = []
        for threshold in grid:
            scores = []
            for probs in repeat_probs:
                pred = self._labels_from_side_probs(side_frame, probs, threshold)
                scores.append(
                    self.evaluator.macro_f1(
                        truth.reindex(pred.file_id).to_numpy(), pred.prediction.to_numpy()
                    )
                )
            curve_rows.append(
                {"threshold": threshold, "macro_f1_mean": float(np.mean(scores)),
                 "macro_f1_std": float(np.std(scores))}
            )
        curve = pd.DataFrame(curve_rows)
        best_row = curve.loc[curve.macro_f1_mean.idxmax()]
        best_threshold = float(best_row.threshold)

        per_repeat = []
        for probs in repeat_probs:
            pred = self._labels_from_side_probs(side_frame, probs, best_threshold)
            per_repeat.append(
                self.evaluator.macro_f1(
                    truth.reindex(pred.file_id).to_numpy(), pred.prediction.to_numpy()
                )
            )

        default_scores = []
        for probs in repeat_probs:
            pred = self._labels_from_side_probs(side_frame, probs, 0.5)
            default_scores.append(
                self.evaluator.macro_f1(
                    truth.reindex(pred.file_id).to_numpy(), pred.prediction.to_numpy()
                )
            )

        # OOF predictions from the mean probability across repeats, for the
        # confusion matrix and the speed diagnostics.
        mean_probs = np.mean(repeat_probs, axis=0)
        oof = self._labels_from_side_probs(side_frame, mean_probs, best_threshold)
        oof["label"] = truth.reindex(oof.file_id).to_numpy()
        oof = oof.merge(
            file_frame[["file_id", "speed_ms", "is_stationary"]], on="file_id", how="left"
        )

        return CVReport(
            strategy="per_side",
            macro_f1_mean=float(np.mean(per_repeat)),
            macro_f1_std=float(np.std(per_repeat)),
            macro_f1_per_repeat=[float(s) for s in per_repeat],
            threshold=best_threshold,
            threshold_curve=curve,
            oof_predictions=oof,
            macro_f1_at_default=float(np.mean(default_scores)),
        )

    # -- multiclass strategy (benchmark) -----------------------------------
    def cross_validate_multiclass(self, X: pd.DataFrame, file_frame: pd.DataFrame) -> CVReport:
        y = file_frame["label"].to_numpy()
        per_repeat, oof_frames = [], []

        for repeat in range(self.cv_config.n_repeats):
            seed = self.cv_config.random_state + 1000 * repeat
            preds = np.empty(len(y), dtype=object)
            splitter = StratifiedKFold(
                n_splits=self.cv_config.n_splits, shuffle=True, random_state=seed
            )
            for train_idx, test_idx in splitter.split(X, y):
                model = RailForestModel(self.model_config)
                model.fit(X.iloc[train_idx], y[train_idx])
                preds[test_idx] = model.predict_multiclass(X.iloc[test_idx])
            per_repeat.append(self.evaluator.macro_f1(y, preds))
            oof_frames.append(
                pd.DataFrame({"file_id": file_frame.file_id, "prediction": preds, "label": y})
            )

        oof = oof_frames[0].merge(
            file_frame[["file_id", "speed_ms", "is_stationary"]], on="file_id", how="left"
        )
        return CVReport(
            strategy="multiclass",
            macro_f1_mean=float(np.mean(per_repeat)),
            macro_f1_std=float(np.std(per_repeat)),
            macro_f1_per_repeat=[float(s) for s in per_repeat],
            threshold=float("nan"),
            oof_predictions=oof,
            macro_f1_at_default=float(np.mean(per_repeat)),
        )

    # -- final fit ---------------------------------------------------------
    def fit_final(
        self, X: pd.DataFrame, side_frame: pd.DataFrame, threshold: float
    ) -> RailForestModel:
        model = RailForestModel(self.model_config)
        if self.model_config.strategy == "per_side":
            model.fit(X, side_frame["target"].to_numpy())
            model.threshold = threshold
        else:
            model.fit(X, side_frame["label"].to_numpy())
        return model
