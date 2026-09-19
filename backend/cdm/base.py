"""Shared contract every subsystem expert implements."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .explain import TreeExplanation


@dataclass
class Verdict:
    """One expert's answer about one input file.

    ``fault_detected`` is deliberately optional-valued: SHM is a regression
    task with no fault/no-fault notion at all, and ACV is a localisation task
    where a fault is known to exist by construction, so neither can honestly
    return a boolean. The router-level "or no fault" outcome comes from the
    experts that can actually decide it (rail and door).
    """

    subsystem: str
    fault_detected: bool | None
    summary: str
    detail: dict[str, Any] = field(default_factory=dict)
    confidence: float | None = None
    #: Node-level and SHAP attribution for this prediction, when the deciding
    #: model is tree-based.
    explanation: TreeExplanation | None = None

    def __str__(self) -> str:
        status = {True: "FAULT", False: "no fault", None: "n/a"}[self.fault_detected]
        head = f"[{self.subsystem}] {status}: {self.summary}"
        if self.confidence is not None:
            head += f"  (confidence {self.confidence:.2f})"
        if self.explanation is not None:
            top = self.explanation.top_node()
            if top is not None:
                head += f"\n        {self.explanation.plain_summary(2)}"
        return head


class SubsystemExpert(abc.ABC):
    """A stage-2 model: one subsystem, one task, one submission schema."""

    #: Router key and dataset folder name.
    name: str = ""
    #: Filename the Info Kit requires for this subsystem's submission.
    submission_filename: str = ""

    @abc.abstractmethod
    def fit(self) -> "SubsystemExpert":
        """Train from the subsystem's own training data."""

    @abc.abstractmethod
    def predict_file(self, path: str | Path) -> Verdict:
        """Score one input file."""

    @abc.abstractmethod
    def submission_rows(self, paths: list[Path]) -> pd.DataFrame:
        """Rows in this subsystem's required *_predictions.csv schema."""

    @abc.abstractmethod
    def save(self, path: str | Path) -> Path: ...

    @classmethod
    @abc.abstractmethod
    def load(cls, path: str | Path) -> "SubsystemExpert": ...

    #: Cross-validated headline score, filled in by fit() for reporting.
    cv_score: float | None = None
    cv_metric: str = ""
