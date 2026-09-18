"""Turn raw axle-box CSV recordings into cached feature matrices.

Layout of a raw file (Rail_Corrugation_Info_Kit.md Section 2.1):

    column 0        rotating-speed pulse train (0/1)
    columns 1..128  64 axle boxes x (vibration, shock), ordered
                    car 1 pos 1 vib, car 1 pos 1 shock, car 1 pos 2 vib, ...

Odd positions (1,3,5,7) ride the Side I rail, even positions the Side II rail,
and the two rails must be judged independently from the same recording.

Two frame shapes are produced:

``build_file_frame``  one row per file, with each side's pooled features held
                      in its own columns. This feeds the ``multiclass``
                      strategy.
``to_side_frame``     two rows per file - one per rail - re-expressed from the
                      point of view of "this side" vs "the other side". This
                      feeds the ``per_side`` strategy, letting a single binary
                      forest learn the corrugation signature from all 38 fault
                      examples instead of splitting them 14/24 across classes.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

from .config import (
    CLASS_ORDER,
    FAULT_SIDE_OF_LABEL,
    N_CARS,
    N_POSITIONS,
    SAMPLING_RATE_HZ,
    SIDE_OF_POSITION,
    SIDES,
    SIGNALS,
    FeatureConfig,
    PipelineConfig,
)
from . import signal_features as sf

META_COLUMNS = ("file_id", "label", "speed_ms", "is_stationary")

#: Bump whenever the extraction logic changes shape or meaning. The cache key
#: hashes the FeatureConfig, which would not otherwise notice a code edit and
#: would happily serve a stale frame.
FEATURE_VERSION = 2


_HEADER_RE = re.compile(
    r"(vibration|shock)\s+of\s+bearing\s+in\s+position\s+(\d+)\s+of\s+car\s+(\d+)", re.I
)


def _validate_columns(columns, filename: str) -> None:
    """Confirm the file's real headers match the documented channel order.

    The info kit states the layout, but a silently reordered file would
    mis-assign every axle box to the wrong rail and quietly wreck the
    predictions, so the order is checked rather than assumed. Files whose
    headers are not in the documented prose form are accepted on position.
    """
    parsed = [_HEADER_RE.search(str(c)) for c in list(columns)[1:]]
    if not all(parsed):
        return  # headers not in the expected prose form; fall back to order
    for idx, match in enumerate(parsed):
        signal = "vib" if match.group(1).lower() == "vibration" else "shock"
        position, car = int(match.group(2)), int(match.group(3))
        if channel_column(car, position, signal) != idx:
            raise ValueError(
                f"{filename}: column {idx + 2} is '{columns[idx + 1]}' but the documented "
                f"layout puts it at index {channel_column(car, position, signal)}. "
                "Channel-to-rail mapping cannot be trusted."
            )


def channel_column(car: int, position: int, signal: str) -> int:
    """Index into the 128-column data block (speed column already removed)."""
    if signal not in SIGNALS:
        raise ValueError(f"signal must be one of {SIGNALS}, got {signal!r}")
    return (car - 1) * (N_POSITIONS * 2) + (position - 1) * 2 + SIGNALS.index(signal)


def side_channel_columns(side: str, signal: str) -> list[int]:
    """All 32 column indices for one rail side and one signal type."""
    return [
        channel_column(car, pos, signal)
        for car in range(1, N_CARS + 1)
        for pos in range(1, N_POSITIONS + 1)
        if SIDE_OF_POSITION[pos] == side
    ]


class RailDataLoader:
    """Loads recordings and materialises feature frames, with a parquet cache."""

    def __init__(self, config: PipelineConfig | None = None):
        self.config = config or PipelineConfig()
        self.fcfg: FeatureConfig = self.config.features

    # -- raw IO ------------------------------------------------------------
    @staticmethod
    def load_raw(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
        """Return ``(speed_channel, data)`` where data is ``(n_samples, 128)``."""
        frame = pd.read_csv(path, dtype=np.float32)
        _validate_columns(frame.columns, Path(path).name)
        arr = frame.to_numpy(dtype=np.float32, copy=False)
        if arr.shape[1] != 1 + N_CARS * N_POSITIONS * 2:
            raise ValueError(
                f"{Path(path).name}: expected {1 + N_CARS * N_POSITIONS * 2} columns, got {arr.shape[1]}"
            )
        return arr[:, 0], arr[:, 1:]

    # -- per-file feature extraction ---------------------------------------
    def extract_file_features(self, path: str | Path) -> dict[str, float | str]:
        """Feature dictionary for a single recording."""
        path = Path(path)
        speed_channel, data = self.load_raw(path)
        speed = sf.estimate_speed_ms(speed_channel, fs=SAMPLING_RATE_HZ)
        stationary = speed < self.fcfg.min_speed_ms

        row: dict[str, float | str] = {
            "file_id": path.name,
            "speed_ms": speed,
            "is_stationary": float(stationary),
        }

        # Per-side, per-signal: compute features for each of the 32 axle boxes
        # on that rail, then pool them into a fixed-width summary.
        per_side: dict[tuple[str, str], dict[str, np.ndarray]] = {}
        for side in SIDES:
            for sig in SIGNALS:
                cols = side_channel_columns(side, sig)
                collected: dict[str, list[float]] = {}
                for col in cols:
                    feats = sf.channel_features(
                        data[:, col],
                        speed,
                        self.fcfg.wavelength_bands_m,
                        fs=SAMPLING_RATE_HZ,
                        nperseg=self.fcfg.welch_nperseg,
                        overlap=self.fcfg.welch_overlap,
                        min_speed_ms=self.fcfg.min_speed_ms,
                    )
                    for key, value in feats.items():
                        collected.setdefault(key, []).append(value)
                per_side[(side, sig)] = {k: np.asarray(v) for k, v in collected.items()}

        all_keys = sorted(next(iter(per_side.values())).keys())
        absolute_keys = self._active_feature_keys(all_keys)

        pooled: dict[tuple[str, str, str, str], float] = {}
        for side in SIDES:
            for sig in SIGNALS:
                values = per_side[(side, sig)]
                for key in all_keys:
                    for stat in self.fcfg.pool_stats:
                        pooled[(side, sig, key, stat)] = sf.pool(values[key], stat)
                        if key in absolute_keys:
                            row[f"side{side}__{sig}__{key}__{stat}"] = pooled[(side, sig, key, stat)]

        if self.fcfg.include_side_contrast:
            # Both rails were measured in the same file, at the same speed, on
            # the same train. Their difference therefore isolates the rail's
            # own condition from every session-level confound - speed above all.
            for sig in SIGNALS:
                for key in all_keys:
                    for stat in self.fcfg.pool_stats:
                        a = pooled[("I", sig, key, stat)]
                        b = pooled[("II", sig, key, stat)]
                        row[f"contrast__{sig}__{key}__{stat}"] = sf.contrast_value(a, b, key)
        return row

    def _active_feature_keys(self, all_keys) -> list[str]:
        keys = sorted(all_keys)
        if not self.fcfg.include_scale_features:
            keys = [k for k in keys if sf.is_scale_free(k)]
        return keys

    # -- frame building ----------------------------------------------------
    def _cache_key(self, split: str) -> str:
        payload = json.dumps(
            {"split": split, "version": FEATURE_VERSION, "features": asdict(self.fcfg)}, sort_keys=True, default=str
        )
        digest = hashlib.sha1(payload.encode()).hexdigest()[:12]
        return f"features_{split}_{digest}.parquet"

    def build_file_frame(self, split: str = "train", *, use_cache: bool = True) -> pd.DataFrame:
        """One row per recording. ``split`` is ``"train"`` or ``"test"``."""
        self.config.ensure_dirs()
        cache_path = self.config.cache_dir / self._cache_key(split)
        if use_cache and cache_path.exists():
            return pd.read_parquet(cache_path)

        directory = self.config.train_dir if split == "train" else self.config.test_dir
        paths = sorted(
            directory.glob("*.csv"),
            key=lambda p: (len(p.stem), p.stem),  # Train2 before Train10
        )
        if not paths:
            raise FileNotFoundError(f"no CSV files under {directory}")

        rows = Parallel(n_jobs=self.config.n_jobs_features, verbose=5)(
            delayed(self.extract_file_features)(p) for p in paths
        )
        frame = pd.DataFrame(rows)

        if split == "train":
            labels = pd.read_csv(self.config.labels_csv)
            frame = frame.merge(
                labels.rename(columns={"filename": "file_id"}), on="file_id", how="left"
            )
            missing = frame.label.isna().sum()
            if missing:
                raise ValueError(f"{missing} training files have no label in Train_Labels.csv")
        else:
            frame["label"] = pd.NA

        frame.to_parquet(cache_path, index=False)
        return frame

    # -- per-side reshaping ------------------------------------------------
    @staticmethod
    def to_side_frame(file_frame: pd.DataFrame) -> pd.DataFrame:
        """Melt one row per file into two rows - one per rail side.

        Columns are renamed so the model always sees the rail under judgement
        as ``self__*`` and its partner as ``other__*``. ``contrast__*`` is
        oriented as *self minus other*, so a positive value always means "this
        rail shows more of it". The forest is therefore side-agnostic and can
        pool all 38 fault examples rather than learning Side I and Side II as
        two unrelated classes from 14 and 24 samples.
        """
        blocks = []
        for side in SIDES:
            other = "II" if side == "I" else "I"
            cols: dict[str, object] = {
                "file_id": file_frame["file_id"],
                "side": side,
                "speed_ms": file_frame["speed_ms"],
                "is_stationary": file_frame["is_stationary"],
            }

            for col in file_frame.columns:
                if col.startswith(f"side{side}__"):
                    cols["self__" + col.split("__", 1)[1]] = file_frame[col]
                elif col.startswith(f"side{other}__"):
                    cols["other__" + col.split("__", 1)[1]] = file_frame[col]
                elif col.startswith("contrast__"):
                    # Stored as Side I minus Side II; flip for the Side II row.
                    cols[col] = file_frame[col] if side == "I" else -file_frame[col]

            if "label" in file_frame.columns:
                cols["label"] = file_frame["label"]
                cols["target"] = (
                    file_frame["label"].map(FAULT_SIDE_OF_LABEL).eq(side).astype(int)
                )
            # Build in one shot: assigning ~600 columns individually fragments
            # the frame badly and is markedly slower.
            blocks.append(pd.DataFrame(cols, index=file_frame.index))

        out = pd.concat(blocks, ignore_index=True)
        return out.sort_values(["file_id", "side"], kind="stable").reset_index(drop=True)

    # -- column helpers ----------------------------------------------------
    def feature_columns(self, frame: pd.DataFrame) -> list[str]:
        """Model input columns: everything except metadata and targets."""
        excluded = set(META_COLUMNS) | {"target", "side"}
        cols = [c for c in frame.columns if c not in excluded]
        if self.fcfg.include_speed_feature:
            cols.append("speed_ms")
        # is_stationary is a physical state flag, not an amplitude - always useful.
        cols.append("is_stationary")
        seen: set[str] = set()
        return [c for c in cols if not (c in seen or seen.add(c))]


def label_distribution(frame: pd.DataFrame) -> pd.Series:
    return frame["label"].value_counts().reindex(CLASS_ORDER).fillna(0).astype(int)
