"""Explanations for tree models: which split fired, and which feature mattered.

Two complementary decompositions are produced for a single prediction.

**Node-path decomposition** — the "most salient node". Walking the decision path
a sample actually takes, every internal node moves the prediction from its own
value to its chosen child's value. Summing those steps telescopes exactly:

    base_value + sum(contributions) == predicted value

so the reported nodes are a faithful account of how the number was produced, not
an approximation. For a forest the per-tree decompositions are averaged, which is
valid because a forest's prediction *is* the mean of its trees. Contributions are
then grouped by ``(feature, direction)`` so the output reads as a rule the whole
ensemble applied - "this rail's RMS contrast exceeded -0.118, which pushed the
prediction up by 0.14, and 412 of 1200 trees took that branch" - rather than as
thousands of individual node ids.

**SHAP feature attribution** — the complementary view. SHAP answers "which
*feature* mattered", spreading credit across the whole ensemble; the node walk
answers "which *split* fired on this path". They are different questions, and a
feature can rank highly under one and not the other, so both are reported.

The module is deliberately generic over any scikit-learn tree model
(``DecisionTree*``, ``RandomForest*``) and imports nothing from the subsystem
packages, so all four experts share one implementation.
"""

from __future__ import annotations

import weakref
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .glossary import describe_condition, describe_feature

#: TreeExplainer construction is expensive on a 1200-tree forest, so instances
#: are cached per estimator. A weak-keyed cache keeps the explainer out of the
#: estimator's own __dict__, which matters because the experts joblib.dump their
#: models and a SHAP explainer should never ride along into the pickle.
_EXPLAINER_CACHE: "weakref.WeakKeyDictionary[Any, Any]" = weakref.WeakKeyDictionary()


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------
@dataclass
class NodeContribution:
    """One split condition, aggregated over every tree that applied it."""

    feature: str
    threshold: float
    direction: str  # "<=" or ">" - the branch this sample took
    contribution: float
    n_trees: int
    mean_depth: float

    def rule(self) -> str:
        """The exact split, for anyone who wants the number."""
        return f"{self.feature} {self.direction} {self.threshold:.4g}"

    def plain(self) -> str:
        """The same split in plain language, with which way it pushed."""
        effect = "raises" if self.contribution > 0 else "lowers"
        return f"{describe_condition(self.feature, self.direction)} - {effect} the score"

    def to_dict(self) -> dict[str, Any]:
        return {
            "plain": self.plain(),
            "rule": self.rule(),
            "feature": self.feature,
            "feature_label": describe_feature(self.feature),
            "threshold": float(self.threshold),
            "direction": self.direction,
            "contribution": float(self.contribution),
            "n_trees": int(self.n_trees),
            "mean_depth": float(self.mean_depth),
        }


@dataclass
class TreeExplanation:
    """Why a tree model produced the value it did, for one sample."""

    base_value: float
    predicted_value: float
    nodes: list[NodeContribution] = field(default_factory=list)
    feature_shap: pd.Series | None = None
    #: Terms outside the tree entirely - SHM's Miner's-rule anchor, or ACV's
    #: fleet deviation when it falls back to the physics ranking.
    extra_terms: dict[str, float] = field(default_factory=dict)
    #: Free-text note, e.g. that SHM's contributions are in log space.
    units_note: str = ""

    def top_node(self) -> NodeContribution | None:
        return self.nodes[0] if self.nodes else None

    def top(self, k: int = 5) -> list[NodeContribution]:
        return self.nodes[:k]

    def top_features(self, k: int = 5) -> pd.Series:
        if self.feature_shap is None:
            return pd.Series(dtype=float)
        order = self.feature_shap.abs().sort_values(ascending=False).index
        return self.feature_shap.reindex(order).head(k)

    def reasons(self, k: int = 3) -> list[str]:
        """The top drivers as plain sentences - what a result screen shows."""
        return [node.plain() for node in self.top(k)]

    def plain_summary(self, k: int = 3) -> str:
        """Human-readable account, no thresholds or column names."""
        if not self.nodes:
            detail = ", ".join(f"{n.replace('_', ' ')} {v:+.3f}"
                               for n, v in self.extra_terms.items())
            return f"decided without a decision tree{': ' + detail if detail else ''}"
        return "because " + "; and ".join(
            reason.replace(" - raises the score", "").replace(" - lowers the score", "")
            for reason in self.reasons(k)
        )

    def summary(self, k: int = 5) -> str:
        """Full technical account: plain text plus the exact numbers."""
        lines = [
            f"value {self.predicted_value:+.4f}  =  base {self.base_value:+.4f} "
            f"+ nodes {self.predicted_value - self.base_value:+.4f}"
        ]
        if self.units_note:
            lines.append(f"  ({self.units_note})")
        for name, value in self.extra_terms.items():
            lines.append(f"  {name:24s} {value:+.4f}")
        if not self.nodes:
            lines.append("  no decision path (model is not tree-based for this prediction)")
        for i, node in enumerate(self.top(k), 1):
            lines.append(f"  {i}. {node.plain()}")
            lines.append(
                f"     {node.rule():<46s} {node.contribution:+.4f}"
                f"  ({node.n_trees} trees, depth {node.mean_depth:.1f})"
            )
        return "\n".join(lines)

    def to_dict(self, k: int = 8) -> dict[str, Any]:
        """Everything: the readable version and every exact figure behind it."""
        return {
            "plain_summary": self.plain_summary(3),
            "reasons": self.reasons(3),
            "base_value": float(self.base_value),
            "predicted_value": float(self.predicted_value),
            "units_note": self.units_note,
            "extra_terms": {str(a): float(b) for a, b in self.extra_terms.items()},
            "top_nodes": [n.to_dict() for n in self.top(k)],
            "top_features": [
                {"feature": str(f), "feature_label": describe_feature(str(f)), "shap": float(v)}
                for f, v in self.top_features(k).items()
            ],
        }


# --------------------------------------------------------------------------
# Internals
# --------------------------------------------------------------------------
def _iter_trees(estimator) -> list:
    """The individual decision trees, whether given one or an ensemble."""
    if hasattr(estimator, "estimators_"):
        return [t for t in np.asarray(estimator.estimators_, dtype=object).ravel()]
    return [estimator]


def _node_value(tree, node: int, class_index: int | None) -> float:
    """Value a tree predicts at one node.

    For regressors that is the node mean. For classifiers sklearn >= 1.3 already
    stores class *fractions*, but older versions store raw counts, so normalise
    defensively rather than depending on the version.
    """
    values = tree.value[node].ravel().astype(np.float64)
    if class_index is None:
        return float(values[0])
    total = values.sum()
    if total > 0:
        values = values / total
    return float(values[class_index])


def _resolve_class_index(estimator, class_index: int | None) -> int | None:
    """``None`` means regression; classifiers default to the positive class."""
    if not hasattr(estimator, "classes_"):
        return None
    if class_index is not None:
        return class_index
    return len(estimator.classes_) - 1


# --------------------------------------------------------------------------
# Node-path decomposition
# --------------------------------------------------------------------------
def node_contributions(
    estimator,
    x: np.ndarray,
    feature_names: list[str],
    *,
    class_index: int | None = None,
) -> tuple[float, float, list[NodeContribution]]:
    """Decompose one prediction along the decision path it takes.

    Returns ``(base_value, predicted_value, nodes)`` where ``nodes`` is sorted by
    descending absolute contribution and ``base + sum(contributions)`` equals
    ``predicted_value`` exactly.
    """
    row = np.asarray(x, dtype=np.float64).reshape(1, -1)
    if row.shape[1] != len(feature_names):
        raise ValueError(
            f"got {row.shape[1]} feature values but {len(feature_names)} names"
        )

    class_index = _resolve_class_index(estimator, class_index)
    trees = _iter_trees(estimator)
    if not trees:
        return 0.0, 0.0, []

    aggregated: dict[tuple[int, str], dict[str, float]] = {}
    base_total = 0.0
    predicted_total = 0.0

    for tree_model in trees:
        tree = tree_model.tree_
        # sklearn numbers nodes depth-first, so a child's id always exceeds its
        # parent's; CSR indices come back ascending, i.e. already root -> leaf.
        path = tree_model.decision_path(row).indices
        base_total += _node_value(tree, int(path[0]), class_index)
        predicted_total += _node_value(tree, int(path[-1]), class_index)

        for depth in range(len(path) - 1):
            node, child = int(path[depth]), int(path[depth + 1])
            delta = _node_value(tree, child, class_index) - _node_value(tree, node, class_index)
            feature_index = int(tree.feature[node])
            direction = "<=" if child == tree.children_left[node] else ">"
            record = aggregated.setdefault(
                (feature_index, direction),
                {"contribution": 0.0, "n_trees": 0.0, "threshold": 0.0, "depth": 0.0},
            )
            record["contribution"] += delta
            record["n_trees"] += 1.0
            record["threshold"] += float(tree.threshold[node])
            record["depth"] += float(depth)

    n_trees = float(len(trees))
    nodes = [
        NodeContribution(
            feature=feature_names[feature_index],
            # Thresholds differ slightly between trees; report the mean of the
            # ones that actually fired, so the rule stays readable.
            threshold=record["threshold"] / record["n_trees"],
            direction=direction,
            contribution=record["contribution"] / n_trees,
            n_trees=int(record["n_trees"]),
            mean_depth=record["depth"] / record["n_trees"],
        )
        for (feature_index, direction), record in aggregated.items()
    ]
    nodes.sort(key=lambda n: abs(n.contribution), reverse=True)
    return base_total / n_trees, predicted_total / n_trees, nodes


# --------------------------------------------------------------------------
# SHAP feature attribution
# --------------------------------------------------------------------------
def shap_feature_values(
    estimator,
    x: np.ndarray,
    feature_names: list[str],
    *,
    class_index: int | None = None,
) -> pd.Series | None:
    """Per-feature SHAP values for one sample, or ``None`` if unavailable."""
    try:
        import shap
    except ImportError:
        return None

    explainer = _EXPLAINER_CACHE.get(estimator)
    if explainer is None:
        try:
            explainer = shap.TreeExplainer(estimator)
            _EXPLAINER_CACHE[estimator] = explainer
        except Exception:
            return None

    row = np.asarray(x, dtype=np.float64).reshape(1, -1)
    try:
        values = np.asarray(explainer.shap_values(row, check_additivity=False))
    except Exception:
        return None

    if values.ndim == 3:  # classifiers come back as (samples, features, classes)
        index = class_index if class_index is not None else values.shape[2] - 1
        values = values[:, :, min(index, values.shape[2] - 1)]
    return pd.Series(np.asarray(values).reshape(-1), index=feature_names)


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
def explain_prediction(
    estimator,
    x: np.ndarray,
    feature_names: list[str],
    *,
    class_index: int | None = None,
    extra_terms: dict[str, float] | None = None,
    units_note: str = "",
    include_shap: bool = True,
) -> TreeExplanation:
    """Full explanation for one sample: salient nodes plus SHAP features."""
    base, predicted, nodes = node_contributions(
        estimator, x, feature_names, class_index=class_index
    )
    feature_shap = (
        shap_feature_values(estimator, x, feature_names, class_index=class_index)
        if include_shap
        else None
    )
    return TreeExplanation(
        base_value=base,
        predicted_value=predicted,
        nodes=nodes,
        feature_shap=feature_shap,
        extra_terms=dict(extra_terms or {}),
        units_note=units_note,
    )


def physics_explanation(terms: dict[str, float], note: str) -> TreeExplanation:
    """Explanation for a prediction made without a tree at all.

    ACV falls back to a physical ranking when the forest cannot beat it; there is
    no decision path to walk in that case, and reporting an empty tree
    decomposition as though it were one would be misleading.
    """
    return TreeExplanation(
        base_value=0.0,
        predicted_value=float(sum(terms.values())) if terms else 0.0,
        nodes=[],
        feature_shap=None,
        extra_terms=dict(terms),
        units_note=note,
    )
