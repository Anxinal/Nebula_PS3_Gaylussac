"""Scoring and methodology checks for rail corrugation predictions.

The official metric (Info Kit Section 4) is **macro F1** across Normal,
Side I and Side II - the unweighted mean of the three per-class F1 scores, so
a model that never detects a rare class is punished no matter how good its
plain accuracy looks.

Beyond the headline number, this module also measures how much the model is
leaning on train speed. That matters here because every fault recording in the
training set was captured above 9.7 m/s while 44 normal ones are stationary:
a model could score well by learning "fast means faulty" and then fail on a
held-out set with a different speed mix. Section 3.2 of the problem statement
marks exactly this kind of shortcut down.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.metrics import (
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

from .config import CLASS_ORDER


@dataclass
class EvaluationReport:
    macro_f1: float
    accuracy: float
    per_class: pd.DataFrame
    confusion: pd.DataFrame
    n_samples: int
    extras: dict = field(default_factory=dict)

    def __str__(self) -> str:
        lines = [
            f"macro F1 : {self.macro_f1:.4f}   <- official metric",
            f"accuracy : {self.accuracy:.4f}   (n={self.n_samples})",
            "",
            "per class:",
            self.per_class.to_string(),
            "",
            "confusion (rows = true, cols = predicted):",
            self.confusion.to_string(),
        ]
        for key, value in self.extras.items():
            lines += ["", f"{key}:", str(value)]
        return "\n".join(lines)


class RailEvaluator:
    """Computes the competition metric and supporting diagnostics."""

    def __init__(self, class_order: tuple[str, ...] = CLASS_ORDER):
        self.class_order = list(class_order)

    # -- headline metric ---------------------------------------------------
    def macro_f1(self, y_true, y_pred) -> float:
        return float(
            f1_score(y_true, y_pred, labels=self.class_order, average="macro", zero_division=0)
        )

    def evaluate(self, y_true, y_pred) -> EvaluationReport:
        y_true = np.asarray(y_true, dtype=object)
        y_pred = np.asarray(y_pred, dtype=object)

        precision, recall, f1, support = precision_recall_fscore_support(
            y_true, y_pred, labels=self.class_order, zero_division=0
        )
        per_class = pd.DataFrame(
            {"precision": precision, "recall": recall, "f1": f1, "support": support},
            index=self.class_order,
        ).round(4)

        cm = confusion_matrix(y_true, y_pred, labels=self.class_order)
        confusion = pd.DataFrame(cm, index=self.class_order, columns=self.class_order)

        return EvaluationReport(
            macro_f1=self.macro_f1(y_true, y_pred),
            accuracy=float((y_true == y_pred).mean()),
            per_class=per_class,
            confusion=confusion,
            n_samples=int(y_true.size),
        )

    # -- methodology diagnostics ------------------------------------------
    @staticmethod
    def speed_confound_report(
        y_true, y_pred, speed_ms: np.ndarray, *, fault_speed_floor: float | None = None
    ) -> pd.DataFrame:
        """Break accuracy down by speed band.

        If performance collapses outside the speed range where the fault
        examples live, the model has learned the acquisition protocol rather
        than the corrugation signature.
        """
        frame = pd.DataFrame(
            {"true": np.asarray(y_true, dtype=object),
             "pred": np.asarray(y_pred, dtype=object),
             "speed": np.asarray(speed_ms, dtype=float)}
        )
        frame["band"] = pd.cut(
            frame.speed,
            [-0.01, 1.0, 5.0, 10.0, 13.0, 16.0, np.inf],
            labels=["~0 (still)", "1-5", "5-10", "10-13", "13-16", ">16"],
        )
        frame["correct"] = frame.true == frame.pred
        out = frame.groupby("band", observed=False).agg(
            n=("correct", "size"),
            accuracy=("correct", "mean"),
            n_true_fault=("true", lambda s: int((s != "Normal").sum())),
            n_pred_fault=("pred", lambda s: int((s != "Normal").sum())),
        )
        if fault_speed_floor is not None:
            out.attrs["fault_speed_floor"] = fault_speed_floor
        return out.round(4)

    @staticmethod
    def speed_only_baseline(labels: pd.Series, speed_ms: pd.Series) -> dict:
        """Best macro F1 obtainable from train speed alone.

        This is the score to beat: any model not clearly above it is arguably
        just rediscovering the speed confound. Because speed cannot separate
        Side I from Side II, its ceiling is structurally limited - but it is a
        genuine floor for how much of a score the confound can explain.
        """
        labels = pd.Series(labels).reset_index(drop=True)
        speed = pd.Series(speed_ms, dtype=float).reset_index(drop=True)
        majority_fault = labels[labels != "Normal"].value_counts().idxmax()

        best = {"threshold": None, "macro_f1": 0.0}
        for threshold in np.quantile(speed, np.linspace(0.01, 0.99, 99)):
            pred = np.where(speed >= threshold, majority_fault, "Normal")
            score = f1_score(labels, pred, labels=list(CLASS_ORDER), average="macro", zero_division=0)
            if score > best["macro_f1"]:
                best = {"threshold": float(threshold), "macro_f1": float(score)}
        best["note"] = (
            f"predicts '{majority_fault}' above the threshold and Normal below; "
            "cannot distinguish Side I from Side II by construction"
        )
        return best

    @staticmethod
    def prediction_speed_correlation(y_pred, speed_ms) -> float:
        """Point-biserial correlation between 'predicted faulty' and speed."""
        flag = (np.asarray(y_pred, dtype=object) != "Normal").astype(float)
        speed = np.asarray(speed_ms, dtype=float)
        if flag.std() == 0 or speed.std() == 0:
            return 0.0
        return float(np.corrcoef(flag, speed)[0, 1])

    # -- per-side (binary) view -------------------------------------------
    @staticmethod
    def side_level_report(y_true_bin, y_pred_bin) -> pd.DataFrame:
        precision, recall, f1, support = precision_recall_fscore_support(
            y_true_bin, y_pred_bin, labels=[0, 1], zero_division=0
        )
        return pd.DataFrame(
            {"precision": precision, "recall": recall, "f1": f1, "support": support},
            index=["rail normal", "rail corrugated"],
        ).round(4)
