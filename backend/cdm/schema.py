"""Cheap structural fingerprint of an input file, for stage-1 routing.

Only the header and a few leading rows are read, so fingerprinting a 16 MB
recording costs about as much as fingerprinting a small one.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd

AXLE_BOX_RE = re.compile(r"(vibration|shock)\s+of\s+bearing\s+in\s+position", re.I)
CAR_PARAM_RE = re.compile(r"^car\s+\S+\s+-\s+", re.I)

#: Order matters - this is the feature vector the router's tree is trained on.
FEATURE_NAMES = (
    "is_xlsx",
    "n_columns",
    "has_header",
    "log10_rows",
    "frac_axle_box_columns",
    "has_datetime_column",
    "frac_car_param_columns",
    "has_speed_column",
)


@dataclass
class SchemaFingerprint:
    is_xlsx: float
    n_columns: float
    has_header: float
    log10_rows: float
    frac_axle_box_columns: float
    has_datetime_column: float
    frac_car_param_columns: float
    has_speed_column: float

    def to_row(self) -> list[float]:
        data = asdict(self)
        return [float(data[name]) for name in FEATURE_NAMES]


def _count_lines(path: Path, cap: int = 2_000_000) -> int:
    n = 0
    with path.open("rb") as handle:
        for _ in handle:
            n += 1
            if n >= cap:
                break
    return n


def fingerprint(path: str | Path) -> SchemaFingerprint:
    """Structural summary of a file, without loading its payload."""
    import math

    path = Path(path)
    suffix = path.suffix.lower()

    if suffix in (".xlsx", ".xls"):
        header = pd.read_excel(path, nrows=0)
        columns = [str(c) for c in header.columns]
        n_rows = 0  # not read; the column signature is already decisive
        has_header = 1.0
    else:
        with path.open("r", errors="replace") as handle:
            first = handle.readline().rstrip("\n")
        columns = first.split(",")
        # A header row has at least one field that is not a bare number.
        def _numeric(text: str) -> bool:
            try:
                float(text)
                return True
            except ValueError:
                return False
        has_header = 0.0 if all(_numeric(c.strip()) for c in columns if c.strip()) else 1.0
        n_rows = _count_lines(path)

    n_cols = len(columns)
    lowered = [c.strip().lower() for c in columns]
    return SchemaFingerprint(
        is_xlsx=1.0 if suffix in (".xlsx", ".xls") else 0.0,
        n_columns=float(n_cols),
        has_header=has_header,
        log10_rows=float(math.log10(max(n_rows, 1))),
        frac_axle_box_columns=sum(bool(AXLE_BOX_RE.search(c)) for c in columns) / max(n_cols, 1),
        has_datetime_column=1.0 if any(c in ("datetime", "time") for c in lowered) else 0.0,
        frac_car_param_columns=sum(bool(CAR_PARAM_RE.match(c)) for c in columns) / max(n_cols, 1),
        has_speed_column=1.0 if any("rotating speed" in c for c in lowered) else 0.0,
    )
