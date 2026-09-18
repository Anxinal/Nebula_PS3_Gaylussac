"""Random Forest classifier with a SHAP TreeExplainer attached.

Two prediction strategies are supported, both ending in the 3-class label the
submission requires.

``per_side`` (default)
    A *binary* forest answers "is this rail corrugated?" on one row per rail,
    so both Side I and Side II fault examples train the same decision
    function. With only 14 Side I files in the training set, pooling all 38
    fault examples this way is far more sample-efficient than asking one model
    to separate three classes. The two per-rail probabilities are then
    combined into a file-level label.

``multiclass``
    A single 3-class forest over one row per file. Kept for benchmarking, as
    the rubric asks for model comparison.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

from .config import CLASS_NORMAL, CLASS_ORDER, CLASS_SIDE_I, CLASS_SIDE_II, ModelConfig

DEFAULT_THRESHOLD = 0.5


@dataclass
class ShapExplanation:
    """A single prediction's SHAP attribution."""

    prediction: str
    probability: float
    base_value: float
    contributions: pd.Series  # feature -> signed SHAP value, largest |value| first

    def top(self, k: int = 10) -> pd.Series:
        return self.contributions.reindex(
            self.contributions.abs().sort_values(ascending=False).index
        ).head(k)


class RailForestModel:
    """Wraps a RandomForest plus its TreeExplainer behind one interface."""

    def __init__(self, config: ModelConfig | None = None):
        self.config = config or ModelConfig()
        self.forest: RandomForestClassifier | None = None
        self.feature_names: list[str] = []
        self.threshold: float = DEFAULT_THRESHOLD
        self.stationary_override: bool = True
        self._explainer = None

    # -- training ----------------------------------------------------------
    def _new_forest(self) -> RandomForestClassifier:
        return RandomForestClassifier(
            n_estimators=self.config.n_estimators,
            max_depth=self.config.max_depth,
            min_samples_leaf=self.config.min_samples_leaf,
            max_features=self.config.max_features,
            class_weight=self.config.class_weight,
            random_state=self.config.random_state,
            n_jobs=self.config.n_jobs,
            oob_score=False,
        )

    def fit(self, X: pd.DataFrame, y: np.ndarray | pd.Series) -> "RailForestModel":
        self.feature_names = list(X.columns)
        self.forest = self._new_forest()
        self.forest.fit(X.to_numpy(dtype=np.float64), np.asarray(y))
        self._explainer = None  # rebuilt lazily against the new forest
        return self

    # -- prediction --------------------------------------------------------
    def _check_fitted(self) -> RandomForestClassifier:
        if self.forest is None:
            raise RuntimeError("model is not fitted; call fit() or load() first")
        return self.forest

    def _align(self, X: pd.DataFrame) -> np.ndarray:
        missing = set(self.feature_names) - set(X.columns)
        if missing:
            raise ValueError(f"{len(missing)} feature columns missing at predict time, e.g. {sorted(missing)[:5]}")
        return X[self.feature_names].to_numpy(dtype=np.float64)

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        forest = self._check_fitted()
        return forest.predict_proba(self._align(X))

    def fault_probability(self, X: pd.DataFrame) -> np.ndarray:
        """P(this rail is corrugated) - ``per_side`` strategy only."""
        if self.config.strategy != "per_side":
            raise RuntimeError("fault_probability applies to the per_side strategy")
        forest = self._check_fitted()
        proba = self.predict_proba(X)
        positive = list(forest.classes_).index(1)
        return proba[:, positive]

    def predict_file_labels(self, side_frame: pd.DataFrame, X: pd.DataFrame) -> pd.DataFrame:
        """Combine the two per-rail probabilities into one label per file.

        A file is Normal unless at least one rail clears ``threshold``; if one
        does, the file is attributed to whichever rail scores higher. This
        mirrors the dataset definition, where Side I and Side II faults are
        mutually exclusive and Normal means neither rail is corrugated.
        """
        if self.config.strategy != "per_side":
            raise RuntimeError("predict_file_labels applies to the per_side strategy")

        scored = side_frame[["file_id", "side"]].copy()
        scored["p_fault"] = self.fault_probability(X)
        if "is_stationary" in side_frame.columns:
            scored["is_stationary"] = side_frame["is_stationary"].to_numpy()
        else:
            scored["is_stationary"] = 0.0

        wide = scored.pivot(index="file_id", columns="side", values="p_fault")
        wide.columns = [f"p_side_{c}" for c in wide.columns]
        stationary = scored.groupby("file_id")["is_stationary"].max()

        p_i = wide["p_side_I"].to_numpy()
        p_ii = wide["p_side_II"].to_numpy()
        best = np.maximum(p_i, p_ii)

        labels = np.where(
            best < self.threshold,
            CLASS_NORMAL,
            np.where(p_i >= p_ii, CLASS_SIDE_I, CLASS_SIDE_II),
        )
        if self.stationary_override:
            # With the train at rest there is no wheel-rail excitation, so a
            # corrugation signature cannot be present in the signal even if the
            # rail underneath is corrugated. Normal is the only defensible call.
            labels = np.where(stationary.to_numpy() > 0, CLASS_NORMAL, labels)

        return pd.DataFrame(
            {
                "file_id": wide.index,
                "prediction": labels,
                "p_side_I": p_i,
                "p_side_II": p_ii,
                "confidence": best,
                "is_stationary": stationary.to_numpy(),
            }
        ).reset_index(drop=True)

    def predict_multiclass(self, X: pd.DataFrame) -> np.ndarray:
        if self.config.strategy != "multiclass":
            raise RuntimeError("predict_multiclass applies to the multiclass strategy")
        forest = self._check_fitted()
        return forest.predict(self._align(X))

    # -- SHAP --------------------------------------------------------------
    @property
    def explainer(self):
        """Lazily built TreeExplainer - exact for tree ensembles."""
        if self._explainer is None:
            import shap

            self._explainer = shap.TreeExplainer(self._check_fitted())
        return self._explainer

    def shap_values(self, X: pd.DataFrame, *, class_index: int | None = None) -> np.ndarray:
        """SHAP values as ``(n_samples, n_features)``.

        shap returns a 3-D array for classifiers; this collapses it to the
        class of interest (the positive class by default for binary).
        """
        values = self.explainer.shap_values(self._align(X), check_additivity=False)
        values = np.asarray(values)
        if values.ndim == 3:
            if class_index is None:
                class_index = values.shape[2] - 1  # positive class for binary
            values = values[:, :, class_index]
        return values

    def expected_value(self, class_index: int | None = None) -> float:
        base = np.atleast_1d(np.asarray(self.explainer.expected_value, dtype=float))
        if class_index is None:
            class_index = base.size - 1
        return float(base[min(class_index, base.size - 1)])

    def global_importance(self, X: pd.DataFrame, *, class_index: int | None = None) -> pd.Series:
        """Mean absolute SHAP value per feature, descending."""
        values = self.shap_values(X, class_index=class_index)
        return pd.Series(
            np.abs(values).mean(axis=0), index=self.feature_names, name="mean_abs_shap"
        ).sort_values(ascending=False)

    def explain_instance(self, X: pd.DataFrame, row: int = 0) -> ShapExplanation:
        """Per-prediction attribution, for the app's explainability panel."""
        single = X.iloc[[row]]
        values = self.shap_values(single)[0]
        proba = float(self.fault_probability(single)[0]) if self.config.strategy == "per_side" \
            else float(self.predict_proba(single).max())
        contributions = pd.Series(values, index=self.feature_names, name="shap")
        return ShapExplanation(
            prediction="fault" if proba >= self.threshold else "normal",
            probability=proba,
            base_value=self.expected_value(),
            contributions=contributions,
        )

    # -- persistence -------------------------------------------------------
    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "forest": self._check_fitted(),
                "feature_names": self.feature_names,
                "threshold": self.threshold,
                "stationary_override": self.stationary_override,
                "config": asdict(self.config),
            },
            path,
            compress=3,
        )
        return path

    @classmethod
    def load(cls, path: str | Path) -> "RailForestModel":
        blob: dict[str, Any] = joblib.load(Path(path))
        model = cls(ModelConfig(**blob["config"]))
        model.forest = blob["forest"]
        model.feature_names = blob["feature_names"]
        model.threshold = blob["threshold"]
        model.stationary_override = blob.get("stationary_override", True)
        return model
