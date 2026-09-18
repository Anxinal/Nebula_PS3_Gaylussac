"""The two-stage stack: route a file, then hand it to that subsystem's expert."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .base import Verdict
from .experts.acv import ACVExpert
from .experts.door import DoorExpert
from .experts.rail import RailExpert
from .experts.shm import SHMExpert
from .paths import ARTIFACTS_DIR, DATASETS_ROOT
from .router import UNKNOWN, Routing, SubsystemRouter

EXPERT_TYPES = {"rail": RailExpert, "shm": SHMExpert, "acv": ACVExpert, "door": DoorExpert}

MODEL_FILES = {
    "rail": "rail_forest.joblib",
    "shm": "shm_expert.joblib",
    "acv": "acv_expert.joblib",
    "door": "door_expert.joblib",
}


@dataclass
class Diagnosis:
    """What the stack concluded about one file, end to end."""

    path: Path
    routing: Routing
    verdict: Verdict | None

    def __str__(self) -> str:
        if self.verdict is None:
            return f"{self.path.name}: {self.routing}  -> no expert available"
        return f"{self.path.name}: {self.routing}\n    {self.verdict}"


class HierarchicalPipeline:
    """Stage-1 router plus the four stage-2 experts."""

    def __init__(self, data_root: str | Path | None = None, artifacts_dir: str | Path | None = None):
        self.data_root = Path(data_root) if data_root else DATASETS_ROOT
        self.artifacts_dir = Path(artifacts_dir) if artifacts_dir else ARTIFACTS_DIR
        # Stage 1 needs no training - it is a deterministic schema dispatcher.
        self.router = SubsystemRouter()
        self.experts: dict[str, object] = {}

    # -- training ----------------------------------------------------------
    def fit(self, subsystems: list[str] | None = None, *, verbose: bool = True) -> "HierarchicalPipeline":
        targets = subsystems or list(EXPERT_TYPES)

        if verbose:
            print("=" * 66)
            print("STAGE 1 - subsystem router (deterministic, no training needed)")
            print("=" * 66)
            for line in SubsystemRouter.describe_rules().splitlines():
                print("  " + line)

        if verbose:
            print("\n" + "=" * 66)
            print("STAGE 2 - subsystem experts")
            print("=" * 66)
        for name in targets:
            if verbose:
                print(f"\n[{name}]")
            expert = EXPERT_TYPES[name]()
            expert.fit(verbose=verbose)
            self.experts[name] = expert
        return self

    # -- inference ---------------------------------------------------------
    def diagnose(self, path: str | Path) -> Diagnosis:
        """Route one file and run the matching expert."""
        path = Path(path)
        routing = self.router.route(path)
        if routing.subsystem == UNKNOWN or routing.subsystem not in self.experts:
            return Diagnosis(path, routing, None)
        return Diagnosis(path, routing, self.experts[routing.subsystem].predict_file(path))

    def diagnose_many(self, paths: list[str | Path]) -> list[Diagnosis]:
        return [self.diagnose(p) for p in paths]

    def group_by_subsystem(self, paths: list[Path]) -> dict[str, list[Path]]:
        """Route a batch, so each expert can score its files in one pass."""
        grouped: dict[str, list[Path]] = {}
        for path in paths:
            grouped.setdefault(self.router.route(path).subsystem, []).append(path)
        return grouped

    def scores(self) -> pd.DataFrame:
        rows = [{"subsystem": name, "metric": e.cv_metric, "cv_score": e.cv_score}
                for name, e in self.experts.items()]
        return pd.DataFrame(rows).sort_values("subsystem").reset_index(drop=True)

    # -- persistence -------------------------------------------------------
    def save(self) -> dict[str, Path]:
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        written: dict[str, Path] = {}
        for name, expert in self.experts.items():
            written[name] = expert.save(self.artifacts_dir / MODEL_FILES[name])
        return written

    @classmethod
    def load(cls, artifacts_dir: str | Path | None = None, data_root: str | Path | None = None) -> "HierarchicalPipeline":
        pipeline = cls(data_root=data_root, artifacts_dir=artifacts_dir)
        for name, klass in EXPERT_TYPES.items():
            path = pipeline.artifacts_dir / MODEL_FILES[name]
            if path.exists():
                pipeline.experts[name] = klass.load(path)
        return pipeline
