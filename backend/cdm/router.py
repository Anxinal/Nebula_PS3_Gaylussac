"""Stage 1: decide which subsystem an input file belongs to.

This is a deterministic dispatcher, not a learned model, and deliberately so.
The four subsystems' file formats are mutually exclusive by construction:

    ACV   an .xlsx whose headers are ``Car <NN> - <parameter>``
    SHM   a headerless single-column stress series
    Rail  129 columns of axle-box channels plus a rotating-speed column
    Door  a controller stream with a Datetime column and ~17 parameters

A classifier trained on these could at best reproduce the rules below, while
adding a failure mode they do not have - a tree always returns *some* class,
so an unrecognised file would be silently handed to the wrong expert instead
of being rejected. The rules return ``unknown`` instead, and say why.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .schema import SchemaFingerprint, fingerprint

UNKNOWN = "unknown"


@dataclass
class Routing:
    subsystem: str
    fingerprint: SchemaFingerprint
    reason: str = ""
    confidence: float = 1.0

    def __str__(self) -> str:
        if self.subsystem == UNKNOWN:
            return f"unrecognised file format - {self.reason}"
        return f"routed to '{self.subsystem}' ({self.reason})"


#: Ordered rules. Each is (subsystem, predicate, human-readable justification).
#: Most structurally distinctive first, so no rule can shadow another.
RULES = (
    (
        "acv",
        lambda f: f.is_xlsx and f.frac_car_param_columns > 0.5,
        "spreadsheet with per-car parameter columns",
    ),
    (
        "rail",
        lambda f: f.frac_axle_box_columns > 0.5 and f.has_speed_column,
        "axle-box vibration channels with a rotating-speed column",
    ),
    (
        "shm",
        lambda f: f.n_columns == 1 and f.has_header == 0.0,
        "headerless single-column stress series",
    ),
    (
        "door",
        lambda f: (not f.is_xlsx) and f.has_datetime_column and 10 <= f.n_columns <= 30,
        "timestamped controller stream with door-parameter columns",
    ),
)


class SubsystemRouter:
    """Routes a file to its subsystem by structural inspection."""

    def route(self, path: str | Path) -> Routing:
        fp = fingerprint(path)
        for subsystem, predicate, reason in RULES:
            if predicate(fp):
                return Routing(subsystem, fp, reason)
        return Routing(
            UNKNOWN, fp,
            f"{int(fp.n_columns)} columns, header={bool(fp.has_header)}, "
            f"xlsx={bool(fp.is_xlsx)} matches no known subsystem",
        )

    def route_many(self, paths: list[str | Path]) -> dict[str, list[Path]]:
        grouped: dict[str, list[Path]] = {}
        for path in paths:
            grouped.setdefault(self.route(path).subsystem, []).append(Path(path))
        return grouped

    @staticmethod
    def describe_rules() -> str:
        lines = ["subsystem routing rules (evaluated in order):"]
        for i, (subsystem, _, reason) in enumerate(RULES, 1):
            lines.append(f"  {i}. {subsystem:5s} <- {reason}")
        lines.append("  -. unknown <- anything else (rejected, never guessed)")
        return "\n".join(lines)
