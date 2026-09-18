"""Command line for the hierarchical stack.

    python -m cdm.cli rules                       # show the routing rules
    python -m cdm.cli train                       # fit every expert, save models
    python -m cdm.cli diagnose --input <file|dir> # route a file and report a verdict
    python -m cdm.cli predict  --input <dir> --output-dir submissions/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from .paths import ARTIFACTS_DIR, DATASETS_ROOT
from .pipeline import EXPERT_TYPES, HierarchicalPipeline
from .router import UNKNOWN, SubsystemRouter


def cmd_rules(args) -> int:
    print(SubsystemRouter.describe_rules())
    return 0


def cmd_train(args) -> int:
    subsystems = args.subsystems.split(",") if args.subsystems else None
    pipeline = HierarchicalPipeline(data_root=args.data_root, artifacts_dir=args.artifacts_dir)
    pipeline.fit(subsystems)

    print("\n" + "=" * 66)
    print("SUMMARY - cross-validated score per subsystem")
    print("=" * 66)
    scores = pipeline.scores()
    print(scores.to_string(index=False))

    # Overall Score divides by 4 regardless of how many were attempted
    # (PS3 specification 5.3); Average Score divides by those attempted.
    total = float(scores.cv_score.fillna(0).sum())
    print(f"\n  Overall Score (sum / 4)          : {total / 4:.4f}")
    print(f"  Average Score (sum / {len(scores)} attempted) : {total / max(len(scores), 1):.4f}")

    written = pipeline.save()
    print("\nsaved models:")
    for name, path in written.items():
        print(f"  {name:6s} -> {path}")
    (Path(args.artifacts_dir or ARTIFACTS_DIR) / "pipeline_scores.json").write_text(
        json.dumps({r.subsystem: {"metric": r.metric, "cv_score": r.cv_score}
                    for r in scores.itertuples()}, indent=2)
    )
    return 0


def _collect(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(p for p in target.rglob("*") if p.suffix.lower() in (".csv", ".xlsx"))


def cmd_diagnose(args) -> int:
    pipeline = HierarchicalPipeline.load(args.artifacts_dir, args.data_root)
    if not pipeline.experts:
        print("no trained experts found; run `train` first", file=sys.stderr)
        return 1

    paths = _collect(Path(args.input))
    if not paths:
        print(f"no .csv or .xlsx files found at {args.input}", file=sys.stderr)
        return 1

    for path in paths[: args.limit]:
        print(pipeline.diagnose(path))
    if len(paths) > args.limit:
        print(f"\n... {len(paths) - args.limit} more files (raise --limit to see them)")
    return 0


def cmd_predict(args) -> int:
    """Route a mixed directory and write each subsystem's submission CSV."""
    pipeline = HierarchicalPipeline.load(args.artifacts_dir, args.data_root)
    if not pipeline.experts:
        print("no trained experts found; run `train` first", file=sys.stderr)
        return 1

    paths = _collect(Path(args.input))
    grouped = pipeline.router.route_many(paths)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"{len(paths)} files routed:")
    for subsystem in sorted(grouped):
        print(f"  {subsystem:8s} {len(grouped[subsystem]):4d}")

    for subsystem, files in sorted(grouped.items()):
        if subsystem == UNKNOWN:
            print(f"\nskipping {len(files)} unrecognised file(s)")
            continue
        expert = pipeline.experts.get(subsystem)
        if expert is None:
            print(f"\nno expert loaded for '{subsystem}', skipping")
            continue
        rows = expert.submission_rows(files)
        destination = out_dir / expert.submission_filename
        rows.to_csv(destination, index=False)
        print(f"\n{subsystem}: {len(rows)} rows -> {destination}")
        if "prediction" in rows.columns and rows.prediction.dtype == object:
            print(rows.prediction.value_counts().to_string())
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cdm", description=__doc__)
    parser.add_argument("--data-root", default=str(DATASETS_ROOT))
    parser.add_argument("--artifacts-dir", default=str(ARTIFACTS_DIR))
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("rules", help="print the subsystem routing rules").set_defaults(func=cmd_rules)

    train = sub.add_parser("train", help="fit the experts and save them")
    train.add_argument("--subsystems", help=f"comma separated subset of {','.join(EXPERT_TYPES)}")
    train.set_defaults(func=cmd_train)

    diagnose = sub.add_parser("diagnose", help="route files and report verdicts")
    diagnose.add_argument("--input", required=True)
    diagnose.add_argument("--limit", type=int, default=20)
    diagnose.set_defaults(func=cmd_diagnose)

    predict = sub.add_parser("predict", help="write every subsystem's submission CSV")
    predict.add_argument("--input", required=True)
    predict.add_argument("--output-dir", default="submissions")
    predict.set_defaults(func=cmd_predict)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
