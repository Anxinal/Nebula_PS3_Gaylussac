"""Command line entry points: ``train``, ``evaluate``, ``predict``, ``explain``.

    python -m rail_cdm.cli train
    python -m rail_cdm.cli evaluate
    python -m rail_cdm.cli explain --top 25
    python -m rail_cdm.cli predict --input <dir> --output rail_predictions.csv
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .config import CLASS_ORDER, PipelineConfig
from .dataloader import RailDataLoader, label_distribution
from .evaluator import RailEvaluator
from .model import RailForestModel
from .trainer import RailTrainer

MODEL_FILENAME = "rail_forest.joblib"


def _load_config(args) -> PipelineConfig:
    cfg = PipelineConfig.from_yaml(args.config) if args.config else PipelineConfig()
    if getattr(args, "data_root", None):
        cfg.data_root = Path(args.data_root)
    return cfg


def _prepare(cfg: PipelineConfig, split: str = "train"):
    loader = RailDataLoader(cfg)
    file_frame = loader.build_file_frame(split)
    side_frame = loader.to_side_frame(file_frame)
    X = side_frame[loader.feature_columns(side_frame)]
    return loader, file_frame, side_frame, X


# ---------------------------------------------------------------------------
def cmd_train(args) -> int:
    cfg = _load_config(args)
    cfg.ensure_dirs()
    loader, file_frame, side_frame, X = _prepare(cfg)

    print(f"training files    : {len(file_frame)}")
    print(f"label distribution:\n{label_distribution(file_frame).to_string()}")
    print(f"feature matrix    : {X.shape} ({int(side_frame.target.sum())} corrugated rails)\n")

    trainer = RailTrainer(cfg.model, cfg.cv)
    evaluator = RailEvaluator()

    if cfg.model.strategy == "per_side":
        report = trainer.cross_validate_per_side(X, side_frame, file_frame)
    else:
        report = trainer.cross_validate_multiclass(X, file_frame)
    print("=" * 62)
    print(report)
    print("=" * 62)

    oof = report.oof_predictions
    print("\n" + str(evaluator.evaluate(oof.label, oof.prediction)))

    baseline = evaluator.speed_only_baseline(file_frame.label, file_frame.speed_ms)
    print("\n--- methodology checks ---")
    print(f"speed-only baseline macro F1 : {baseline['macro_f1']:.4f}  (threshold {baseline['threshold']:.2f} m/s)")
    print(f"model macro F1               : {report.macro_f1_mean:.4f}")
    print(f"margin over the confound     : {report.macro_f1_mean - baseline['macro_f1']:+.4f}")
    print(f"pred/speed correlation       : {evaluator.prediction_speed_correlation(oof.prediction, oof.speed_ms):.3f}")
    print("\naccuracy by speed band:")
    print(evaluator.speed_confound_report(oof.label, oof.prediction, oof.speed_ms).to_string())

    model = trainer.fit_final(X, side_frame, report.threshold)
    path = model.save(cfg.artifacts_dir / MODEL_FILENAME)
    print(f"\nmodel saved -> {path}")

    summary = {
        "strategy": report.strategy,
        "macro_f1_oof_mean": report.macro_f1_mean,
        "macro_f1_oof_std": report.macro_f1_std,
        "macro_f1_per_repeat": report.macro_f1_per_repeat,
        "threshold": report.threshold,
        "speed_only_baseline_macro_f1": baseline["macro_f1"],
        "n_train_files": int(len(file_frame)),
        "n_features": int(X.shape[1]),
    }
    (cfg.artifacts_dir / "training_summary.json").write_text(json.dumps(summary, indent=2))
    oof.to_csv(cfg.artifacts_dir / "oof_predictions.csv", index=False)
    print(f"summary     -> {cfg.artifacts_dir / 'training_summary.json'}")
    return 0


def cmd_evaluate(args) -> int:
    cfg = _load_config(args)
    oof_path = cfg.artifacts_dir / "oof_predictions.csv"
    if not oof_path.exists():
        print("no out-of-fold predictions found; run `train` first", file=sys.stderr)
        return 1
    oof = pd.read_csv(oof_path)
    evaluator = RailEvaluator()
    print(evaluator.evaluate(oof.label, oof.prediction))
    print("\naccuracy by speed band:")
    print(evaluator.speed_confound_report(oof.label, oof.prediction, oof.speed_ms).to_string())
    return 0


def cmd_explain(args) -> int:
    """Global SHAP importances, plus a worked single-prediction attribution."""
    cfg = _load_config(args)
    model_path = cfg.artifacts_dir / MODEL_FILENAME
    if not model_path.exists():
        print("no trained model found; run `train` first", file=sys.stderr)
        return 1

    model = RailForestModel.load(model_path)
    loader, file_frame, side_frame, X = _prepare(cfg)

    print(f"computing SHAP values for {len(X)} rows x {X.shape[1]} features ...")
    importance = model.global_importance(X)
    print(f"\n=== top {args.top} features by mean |SHAP| ===")
    print(importance.head(args.top).to_frame().round(5).to_string())

    grouped = importance.groupby(
        importance.index.to_series().str.split("__").str[0]
    ).sum().sort_values(ascending=False)
    print("\n=== attribution by feature family ===")
    print((grouped / grouped.sum() * 100).round(1).to_frame("share_%").to_string())

    importance.to_csv(cfg.artifacts_dir / "shap_global_importance.csv", header=True)

    faulty = side_frame.index[side_frame.target == 1]
    if len(faulty):
        row = int(faulty[0])
        explanation = model.explain_instance(X, row)
        meta = side_frame.iloc[row]
        print(f"\n=== worked example: {meta.file_id}, rail Side {meta.side} (true label {meta.label}) ===")
        print(f"P(corrugated) = {explanation.probability:.3f}  (base rate {explanation.base_value:.3f}, threshold {model.threshold:.2f})")
        print(explanation.top(args.top).to_frame("shap").round(5).to_string())
    print(f"\nsaved -> {cfg.artifacts_dir / 'shap_global_importance.csv'}")
    return 0


def cmd_predict(args) -> int:
    cfg = _load_config(args)
    if args.input:
        cfg.data_root = Path(args.input).parent if Path(args.input).name == "Test" else cfg.data_root
    model_path = Path(args.model) if args.model else cfg.artifacts_dir / MODEL_FILENAME
    if not model_path.exists():
        print(f"no model at {model_path}; run `train` first", file=sys.stderr)
        return 1

    model = RailForestModel.load(model_path)
    loader = RailDataLoader(cfg)

    input_dir = Path(args.input) if args.input else cfg.test_dir
    paths = sorted(input_dir.glob("*.csv"), key=lambda p: (len(p.stem), p.stem))
    if not paths:
        print(f"no CSV files found in {input_dir}", file=sys.stderr)
        return 1

    from joblib import Parallel, delayed

    rows = Parallel(n_jobs=cfg.n_jobs_features)(
        delayed(loader.extract_file_features)(p) for p in paths
    )
    file_frame = pd.DataFrame(rows)
    file_frame["label"] = pd.NA
    side_frame = loader.to_side_frame(file_frame)
    X = side_frame[model.feature_names]

    predictions = model.predict_file_labels(side_frame, X)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    predictions[["file_id", "prediction"]].to_csv(out, index=False)

    print(f"{len(predictions)} predictions -> {out}")
    print(predictions.prediction.value_counts().reindex(CLASS_ORDER).fillna(0).astype(int).to_string())
    if args.with_scores:
        detail = out.with_name(out.stem + "_scores.csv")
        predictions.to_csv(detail, index=False)
        print(f"per-rail scores -> {detail}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rail_cdm", description=__doc__)
    parser.add_argument("--config", help="optional YAML config file")
    parser.add_argument("--data-root", help="override the dataset root")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("train", help="cross-validate and fit the final model").set_defaults(func=cmd_train)
    sub.add_parser("evaluate", help="re-score saved out-of-fold predictions").set_defaults(func=cmd_evaluate)

    explain = sub.add_parser("explain", help="SHAP importances for the trained model")
    explain.add_argument("--top", type=int, default=20)
    explain.set_defaults(func=cmd_explain)

    predict = sub.add_parser("predict", help="write rail_predictions.csv for a directory of recordings")
    predict.add_argument("--input", help="directory of CSV recordings (default: the dataset Test folder)")
    predict.add_argument("--output", default="rail_predictions.csv")
    predict.add_argument("--model", help="path to a saved model")
    predict.add_argument("--with-scores", action="store_true", help="also write per-rail probabilities")
    predict.set_defaults(func=cmd_predict)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
