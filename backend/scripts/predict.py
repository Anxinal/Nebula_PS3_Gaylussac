#!/usr/bin/env python
"""Inference entry point required by the Info Kit's deliverables section.

    python scripts/predict.py --input <dir of Test*.csv> --output rail_predictions.csv

Emits one row per input file with columns ``file_id`` and ``prediction``,
where prediction is ``Normal``, ``Side I`` or ``Side II``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rail_cdm.cli import cmd_predict  # noqa: E402
from rail_cdm.config import BACKEND_DIR  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="directory containing the recordings to score")
    parser.add_argument("--output", required=True, help="path of the rail_predictions.csv to write")
    parser.add_argument("--model", default=str(BACKEND_DIR / "artifacts" / "rail_forest.joblib"))
    parser.add_argument("--with-scores", action="store_true")
    parser.add_argument("--config", default=None)
    parser.add_argument("--data-root", default=None)
    return cmd_predict(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
