"""Typed configuration for the rail corrugation pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Literal

import yaml

# Repository layout -----------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DATA_ROOT = (
    REPO_ROOT
    / "NebulaX-Hackathon-ProblemStatement"
    / "PS3"
    / "02_Datasets"
    / "Rail_Corrugation"
)

# Physical constants, from Rail_Corrugation_Info_Kit.md Section 2.1 ------------
SAMPLING_RATE_HZ = 10_000.0
"""Axle-box acquisition rate; each file is exactly 1 s long."""

SPEED_WHEEL_TEETH = 90
"""Teeth on the speed sensor's toothed wheel."""

SPEED_WHEEL_DIAMETER_M = 0.85
"""Wheel diameter in metres."""

N_CARS = 8
N_POSITIONS = 8
SIGNALS = ("vib", "shock")

CLASS_NORMAL = "Normal"
CLASS_SIDE_I = "Side I"
CLASS_SIDE_II = "Side II"
CLASS_ORDER = (CLASS_NORMAL, CLASS_SIDE_I, CLASS_SIDE_II)

SIDE_I = "I"
SIDE_II = "II"
SIDES = (SIDE_I, SIDE_II)

# Positions 1,3,5,7 sit on the Side I rail; 2,4,6,8 on the Side II rail.
SIDE_OF_POSITION = {p: (SIDE_I if p % 2 == 1 else SIDE_II) for p in range(1, N_POSITIONS + 1)}

#: Label -> which side carries the corrugation (None for Normal).
FAULT_SIDE_OF_LABEL = {CLASS_NORMAL: None, CLASS_SIDE_I: SIDE_I, CLASS_SIDE_II: SIDE_II}


@dataclass(frozen=True)
class FeatureConfig:
    """Controls how a raw 1-second recording becomes a feature vector."""

    #: Wavelength band edges in metres. The info kit puts corrugation at
    #: "a few centimetres to dozens of centimetres", so these log-spaced bands
    #: span 2 cm - 64 cm. Energy is integrated per band and expressed as a
    #: *fraction* of in-band total, which makes it invariant to overall
    #: vibration amplitude (and therefore to speed).
    wavelength_bands_m: tuple[float, ...] = (0.02, 0.04, 0.08, 0.16, 0.32, 0.64)

    #: Welch segment length. At 10 kHz this gives ~4.9 Hz resolution with ~9
    #: averages over the 1 s record - a reasonable bias/variance trade-off.
    welch_nperseg: int = 2048
    welch_overlap: float = 0.5

    #: Below this speed the wheel-rail excitation that reveals corrugation is
    #: absent, so wavelength features are undefined. 44 training files are
    #: fully stationary (0 speed-sensor transitions).
    min_speed_ms: float = 1.0

    #: Statistics used to pool the 32 axle boxes making up one side.
    pool_stats: tuple[str, ...] = ("mean", "median", "p90", "max", "std")

    #: Emit log-ratio features contrasting Side I against Side II. Both rails
    #: are measured at the same speed in the same file, so the contrast is
    #: immune to the speed confound.
    include_side_contrast: bool = True

    #: Include measured speed itself as a feature. Off by default: in the
    #: training set speed separates fault from normal almost perfectly, which
    #: is an artefact of how the recordings were collected, not a property of
    #: corrugation. Turn on only to quantify the confound.
    include_speed_feature: bool = False

    #: Include amplitude-scale features (RMS, peak, absolute band energy).
    #: These grow with speed; scale-free shape features do not.
    include_scale_features: bool = False


@dataclass(frozen=True)
class ModelConfig:
    """Random Forest hyper-parameters and prediction strategy."""

    #: ``per_side`` trains one binary "is this rail corrugated?" forest on
    #: 2 rows per file (544 rows, 38 positive), pooling the fault signature
    #: across both sides. ``multiclass`` trains a single 3-class forest on
    #: 272 rows. per_side is the default - it is far more sample-efficient
    #: given only 14 Side I examples.
    strategy: Literal["per_side", "multiclass"] = "per_side"

    # Selected by grouped-CV sweep (see README). The top few settings sat
    # within one standard deviation of each other, so treat this as "a
    # reasonable region" rather than a finely-tuned optimum.
    n_estimators: int = 1200
    max_depth: int | None = None
    min_samples_leaf: int = 3
    max_features: str | int | float = 0.15
    class_weight: str | None = "balanced_subsample"
    random_state: int = 42
    n_jobs: int = -1


@dataclass(frozen=True)
class CVConfig:
    """Cross-validation and threshold tuning."""

    n_splits: int = 5
    n_repeats: int = 4
    random_state: int = 42

    #: Tune the per_side decision threshold on out-of-fold predictions to
    #: maximise macro F1, rather than defaulting to 0.5.
    tune_threshold: bool = True
    threshold_grid: tuple[float, ...] = tuple(round(0.02 * i, 2) for i in range(1, 50))


@dataclass
class PipelineConfig:
    data_root: Path = DATA_ROOT
    artifacts_dir: Path = BACKEND_DIR / "artifacts"
    cache_dir: Path = BACKEND_DIR / "artifacts" / "cache"
    features: FeatureConfig = field(default_factory=FeatureConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    cv: CVConfig = field(default_factory=CVConfig)
    n_jobs_features: int = -1

    @property
    def train_dir(self) -> Path:
        return self.data_root / "Train"

    @property
    def test_dir(self) -> Path:
        return self.data_root / "Test"

    @property
    def labels_csv(self) -> Path:
        return self.data_root / "Train_Labels.csv"

    @classmethod
    def from_yaml(cls, path: str | Path) -> "PipelineConfig":
        raw = yaml.safe_load(Path(path).read_text()) or {}
        cfg = cls()
        if "data_root" in raw:
            cfg.data_root = Path(raw["data_root"]).expanduser()
        if "artifacts_dir" in raw:
            cfg.artifacts_dir = Path(raw["artifacts_dir"]).expanduser()
            cfg.cache_dir = cfg.artifacts_dir / "cache"
        if "n_jobs_features" in raw:
            cfg.n_jobs_features = int(raw["n_jobs_features"])
        for section, klass in (("features", FeatureConfig), ("model", ModelConfig), ("cv", CVConfig)):
            if section in raw and raw[section]:
                current = asdict(getattr(cfg, section))
                current.update(raw[section])
                # tuples survive a YAML round-trip as lists
                for key, value in list(current.items()):
                    default = getattr(getattr(cfg, section), key)
                    if isinstance(default, tuple) and isinstance(value, list):
                        current[key] = tuple(value)
                setattr(cfg, section, klass(**current))
        return cfg

    def ensure_dirs(self) -> None:
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
