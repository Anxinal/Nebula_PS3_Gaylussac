"""Tests for node-level and SHAP explanations.

The load-bearing property is **additivity**: ``base + sum(contributions)`` must
equal the model's own prediction. If it does not, the reported nodes are not a
faithful account of how that prediction was produced, and the whole feature is
worse than useless - it would look authoritative while being wrong.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cdm.explain import (
    NodeContribution,
    TreeExplanation,
    explain_prediction,
    node_contributions,
    physics_explanation,
    shap_feature_values,
)
from cdm.glossary import describe_condition, describe_feature

FEATURES = [f"f{i}" for i in range(5)]


@pytest.fixture(scope="module")
def data():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 5))
    # f0 and f2 are the real drivers; the rest is noise.
    y_class = ((X[:, 0] + 0.5 * X[:, 2]) > 0).astype(int)
    y_reg = 2.0 * X[:, 0] + X[:, 1]
    return X, y_class, y_reg


# -- additivity -----------------------------------------------------------
def test_additivity_for_random_forest_classifier(data):
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=40, random_state=0).fit(X, y)
    for i in range(15):
        base, predicted, nodes = node_contributions(model, X[i], FEATURES)
        assert base + sum(n.contribution for n in nodes) == pytest.approx(predicted, abs=1e-10)
        assert predicted == pytest.approx(model.predict_proba(X[i : i + 1])[0, 1], abs=1e-10)


def test_additivity_for_random_forest_regressor(data):
    X, _, y = data
    model = RandomForestRegressor(n_estimators=40, random_state=0).fit(X, y)
    for i in range(15):
        base, predicted, nodes = node_contributions(model, X[i], FEATURES)
        assert base + sum(n.contribution for n in nodes) == pytest.approx(predicted, abs=1e-9)
        assert predicted == pytest.approx(model.predict(X[i : i + 1])[0], abs=1e-9)


@pytest.mark.parametrize("estimator", [DecisionTreeClassifier, DecisionTreeRegressor])
def test_works_on_a_bare_decision_tree(data, estimator):
    """Not only ensembles - a single tree must decompose too."""
    X, y_class, y_reg = data
    y = y_class if estimator is DecisionTreeClassifier else y_reg
    model = estimator(random_state=0, max_depth=4).fit(X, y)
    base, predicted, nodes = node_contributions(model, X[0], FEATURES)
    assert nodes, "a fitted tree of depth 4 must contribute at least one node"
    assert base + sum(n.contribution for n in nodes) == pytest.approx(predicted, abs=1e-10)


def test_leaf_only_tree_has_no_nodes(data):
    """A stump with no splits should decompose to nothing, not crash."""
    X, y, _ = data
    model = DecisionTreeClassifier(max_depth=1, random_state=0).fit(X, np.zeros(len(X)))
    base, predicted, nodes = node_contributions(model, X[0], FEATURES)
    assert nodes == []
    assert base == pytest.approx(predicted)


# -- correctness of the reported rule ------------------------------------
def test_direction_matches_the_branch_the_sample_took(data):
    """A node reported as '<=' must be one where the sample went left.

    Checked on a single tree, where the threshold is exact. Across a forest the
    reported threshold is the mean of the ones that fired, so an individual
    sample need not satisfy it.
    """
    X, y, _ = data
    model = DecisionTreeClassifier(random_state=0, max_depth=5).fit(X, y)
    for i in range(20):
        _, _, nodes = node_contributions(model, X[i], FEATURES)
        for node in nodes:
            value = X[i][FEATURES.index(node.feature)]
            if node.direction == "<=":
                assert value <= node.threshold
            else:
                assert value > node.threshold


def test_feature_names_map_to_the_right_columns(data):
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=30, random_state=0).fit(X, y)
    _, _, nodes = node_contributions(model, X[0], FEATURES)
    assert {n.feature for n in nodes} <= set(FEATURES)
    # f0 and f2 generate the label, so one of them should dominate.
    assert nodes[0].feature in {"f0", "f2"}


def test_wrong_number_of_feature_names_is_rejected(data):
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=5, random_state=0).fit(X, y)
    with pytest.raises(ValueError, match="feature values"):
        node_contributions(model, X[0], ["only", "two"])


def test_nodes_are_sorted_by_absolute_contribution(data):
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=30, random_state=0).fit(X, y)
    _, _, nodes = node_contributions(model, X[0], FEATURES)
    magnitudes = [abs(n.contribution) for n in nodes]
    assert magnitudes == sorted(magnitudes, reverse=True)


# -- SHAP -----------------------------------------------------------------
def test_shap_values_are_additive_against_the_expected_value(data):
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=30, random_state=0).fit(X, y)
    values = shap_feature_values(model, X[0], FEATURES)
    assert values is not None and len(values) == len(FEATURES)

    import shap

    explainer = shap.TreeExplainer(model)
    base = np.atleast_1d(np.asarray(explainer.expected_value, dtype=float))[-1]
    assert base + values.sum() == pytest.approx(
        model.predict_proba(X[:1])[0, 1], abs=1e-6
    )


def test_shap_and_node_walk_agree_on_the_dominant_feature(data):
    """Different decompositions, but they should not disagree about what drove it."""
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=60, random_state=0).fit(X, y)
    explanation = explain_prediction(model, X[0], FEATURES)
    assert explanation.top_node().feature in {"f0", "f2"}
    assert explanation.top_features(2).index[0] in {"f0", "f2"}


# -- container behaviour --------------------------------------------------
def test_to_dict_is_json_serialisable(data):
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=20, random_state=0).fit(X, y)
    payload = explain_prediction(model, X[0], FEATURES).to_dict()
    text = json.dumps(payload)
    restored = json.loads(text)
    assert restored["top_nodes"] and "rule" in restored["top_nodes"][0]
    assert isinstance(restored["base_value"], float)


def test_physics_explanation_has_no_tree_nodes():
    """ACV's fallback ranks without a forest; it must say so, not fake a path."""
    explanation = physics_explanation({"dev_shortfall_mean_K": 0.42}, "physics ranking")
    assert explanation.nodes == []
    assert explanation.top_node() is None
    assert explanation.extra_terms["dev_shortfall_mean_K"] == pytest.approx(0.42)
    assert "no decision path" in explanation.summary()
    json.dumps(explanation.to_dict())


def test_empty_explanation_summary_does_not_crash():
    assert isinstance(TreeExplanation(base_value=0.0, predicted_value=0.0).summary(), str)


def test_node_rule_is_readable():
    node = NodeContribution("contrast__vib__rms__mean", -0.1181, "<=", 0.14, 412, 2.3)
    assert node.rule() == "contrast__vib__rms__mean <= -0.1181"
    assert node.to_dict()["n_trees"] == 412


# -- plain language -------------------------------------------------------
def test_plain_wording_follows_the_branch_direction():
    high = NodeContribution("cur_phase3", 319.5, ">", 0.07, 140, 0.3)
    low = NodeContribution("cur_phase3", 319.5, "<=", -0.07, 140, 0.3)
    assert "too high" in high.plain() and "raises" in high.plain()
    assert "too low" in low.plain() and "lowers" in low.plain()


@pytest.mark.parametrize("feature,expected", [
    ("cur_phase3", "stroke phase 4 of 8"),          # 0-indexed internally, 1-indexed for people
    ("cur_over_emf", "torque per unit speed"),
    ("cur_per_travel", "against resistance"),
    ("log_S5", "Miner's-rule term"),
    ("kurtosis", "impulsiveness"),
    ("dev_frac_above_setpoint", "compared with the rest of the fleet"),
    ("z_indoor_mean", "z-score"),
    ("rank_shortfall_mean", "rank among the eight"),
    ("is_stationary", "stationary"),
])
def test_glossary_translates_known_features(feature, expected):
    assert expected in describe_feature(feature)


def test_wavelength_bands_name_the_real_physical_band():
    """Rail corrugation is a wavelength phenomenon; 'band 2' means nothing."""
    assert "8-16 cm" in describe_feature("contrast__vib__wlfrac2__mean")
    assert "2-4 cm" in describe_feature("self__shock__wlabs0__max")


def test_rail_scope_is_spelled_out():
    text = describe_feature("contrast__vib__rms__max")
    assert "Side I vs Side II" in text and "vibration" in text and "worst axle box" in text
    assert "this rail's" in describe_feature("self__vib__rms__mean")
    assert "the opposite rail's" in describe_feature("other__vib__rms__mean")


def test_unknown_feature_falls_back_to_its_raw_name():
    assert describe_feature("some_unmapped_thing") == "some_unmapped_thing"
    assert describe_feature("a__b__c__d__e") == "a__b__c__d__e"


def test_json_keeps_the_exact_numbers_alongside_the_plain_text(data):
    """The readable version is additive - it must not replace the detail."""
    X, y, _ = data
    model = RandomForestClassifier(n_estimators=20, random_state=0).fit(X, y)
    payload = json.loads(json.dumps(explain_prediction(model, X[0], FEATURES).to_dict()))
    assert payload["plain_summary"].startswith("because ")
    assert payload["reasons"]
    node = payload["top_nodes"][0]
    for key in ("plain", "rule", "feature", "feature_label",
                "threshold", "direction", "contribution", "n_trees"):
        assert key in node, f"{key} must survive into the JSON"


def test_physics_fallback_plain_summary_says_no_tree():
    explanation = physics_explanation({"dev_shortfall_mean_K": 0.42}, "physics ranking")
    assert "without a decision tree" in explanation.plain_summary()
