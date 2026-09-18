"""Tests for the routing layer and the three new subsystem experts."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cdm.experts.acv import rank_decay_score
from cdm.experts.door import (
    GAP_SECONDS, NORMAL, ABNORMAL, format_datetime, iou_weighted_f1,
    parse_datetime, segment_stream,
)
from cdm.experts.shm import rainflow, stress_moment, turning_points
from cdm.router import RULES, UNKNOWN, SubsystemRouter
from cdm.schema import SchemaFingerprint


# -- router ---------------------------------------------------------------
def _fp(**kwargs) -> SchemaFingerprint:
    base = dict(is_xlsx=0.0, n_columns=17.0, has_header=1.0, log10_rows=4.0,
                frac_axle_box_columns=0.0, has_datetime_column=0.0,
                frac_car_param_columns=0.0, has_speed_column=0.0)
    base.update(kwargs)
    return SchemaFingerprint(**base)


def _route_fingerprint(fp: SchemaFingerprint) -> str:
    for subsystem, predicate, _ in RULES:
        if predicate(fp):
            return subsystem
    return UNKNOWN


@pytest.mark.parametrize("fp,expected", [
    (_fp(is_xlsx=1.0, n_columns=67.0, frac_car_param_columns=0.96, has_datetime_column=1.0), "acv"),
    (_fp(n_columns=129.0, frac_axle_box_columns=0.99, has_speed_column=1.0), "rail"),
    (_fp(n_columns=1.0, has_header=0.0, log10_rows=5.8), "shm"),
    (_fp(n_columns=17.0, has_datetime_column=1.0), "door"),
])
def test_each_subsystem_routes_to_itself(fp, expected):
    assert _route_fingerprint(fp) == expected


def test_unrecognised_file_is_rejected_not_guessed():
    """A tree would return some class; the rules must return unknown."""
    assert _route_fingerprint(_fp(n_columns=2.0, has_datetime_column=0.0)) == UNKNOWN


def test_rules_are_mutually_exclusive():
    """No file may satisfy two subsystem predicates at once."""
    cases = [
        _fp(is_xlsx=1.0, n_columns=67.0, frac_car_param_columns=0.96, has_datetime_column=1.0),
        _fp(n_columns=129.0, frac_axle_box_columns=0.99, has_speed_column=1.0),
        _fp(n_columns=1.0, has_header=0.0, log10_rows=5.8),
        _fp(n_columns=17.0, has_datetime_column=1.0),
    ]
    for fp in cases:
        assert sum(bool(p(fp)) for _, p, _ in RULES) == 1


def test_router_describes_its_rules():
    text = SubsystemRouter.describe_rules()
    for subsystem in ("acv", "rail", "shm", "door", "unknown"):
        assert subsystem in text


# -- SHM: rainflow --------------------------------------------------------
def test_turning_points_drop_intermediate_samples():
    x = np.array([0, 1, 2, 3, 2, 1, 0, 1, 2], dtype=float)
    assert list(turning_points(x)) == [0.0, 3.0, 0.0, 2.0]


def test_constant_amplitude_gives_textbook_cycle_count():
    """n reversals of constant amplitude close (n/2 - 0.5) cycles."""
    cycles = rainflow(np.tile([1.0, -1.0], 6))
    assert np.allclose(np.unique(cycles[:, 0]), [2.0])
    assert cycles[:, 2].sum() == pytest.approx(5.5)


def test_rainflow_of_flat_signal_counts_nothing():
    assert rainflow(np.zeros(100))[:, 2].sum() == pytest.approx(0.0)


def test_stress_moment_is_miner_sum():
    """With unit amplitude the moment equals the total cycle count."""
    cycles = rainflow(np.tile([1.0, -1.0], 6))
    for exponent in (3.0, 5.0):
        assert stress_moment(cycles, exponent) == pytest.approx(5.5)


def test_stress_moment_scales_as_a_power_law():
    """Doubling every stress multiplies S_m by 2**m - the Miner exponent."""
    base = rainflow(np.tile([1.0, -1.0], 6))
    doubled = rainflow(np.tile([2.0, -2.0], 6))
    for m in (3.0, 5.0):
        assert stress_moment(doubled, m) == pytest.approx(stress_moment(base, m) * 2**m)


# -- Door: timestamps, segmentation, metric -------------------------------
def test_datetime_round_trip():
    text = "2023-7-5-0-11-17-664"
    assert format_datetime(parse_datetime(text)) == text


def test_parse_datetime_handles_unpadded_fields():
    ts = parse_datetime("2023-7-5-0-0-3-760")
    assert (ts.month, ts.day, ts.second, ts.microsecond) == (7, 5, 3, 760000)


def test_segmentation_splits_on_sampling_gaps():
    """Cycles are separated by a logging gap, not by any status flag."""
    stamps = (
        [f"2023-7-5-0-0-{i // 50}-{(i % 50) * 20}" for i in range(100)]      # cycle 1
        + [f"2023-7-5-0-1-{i // 50}-{(i % 50) * 20}" for i in range(100)]   # cycle 2, 1 min later
    )
    frame = pd.DataFrame({"_t": [parse_datetime(s) for s in stamps]})
    bounds = segment_stream(frame, GAP_SECONDS)
    assert bounds == [(0, 100), (100, 200)]


def test_single_uninterrupted_stream_is_one_segment():
    stamps = [f"2023-7-5-0-0-{i // 50}-{(i % 50) * 20}" for i in range(100)]
    frame = pd.DataFrame({"_t": [parse_datetime(s) for s in stamps]})
    assert segment_stream(frame, GAP_SECONDS) == [(0, 100)]


def _span(a, b, label):
    return (pd.Timestamp(a), pd.Timestamp(b), label)


def test_iou_f1_is_one_for_an_exact_submission():
    truth = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:10", NORMAL)]
    assert iou_weighted_f1(truth, list(truth)) == pytest.approx(1.0)


def test_wrong_label_cannot_match_even_with_perfect_timing():
    truth = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:10", NORMAL)]
    pred = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:10", ABNORMAL)]
    assert iou_weighted_f1(truth, pred) == 0.0


def test_loose_boundaries_score_below_a_tight_match():
    truth = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:10", NORMAL)]
    tight = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:09", NORMAL)]
    loose = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:30", NORMAL)]
    assert 1.0 > iou_weighted_f1(truth, tight) > iou_weighted_f1(truth, loose) > 0.0


def test_spurious_extra_segments_lower_precision():
    truth = [_span("2023-01-01 00:00:00", "2023-01-01 00:00:10", NORMAL)]
    pred = truth + [_span("2023-01-01 01:00:00", "2023-01-01 01:00:10", NORMAL)]
    assert iou_weighted_f1(truth, pred) == pytest.approx(2 * 1.0 * 0.5 / 1.5)


def test_perfect_segmentation_reduces_metric_to_accuracy():
    """With exact boundaries the IoU-weighted F1 collapses to label accuracy."""
    spans = [(pd.Timestamp(f"2023-01-01 00:{i:02d}:00"),
              pd.Timestamp(f"2023-01-01 00:{i:02d}:30")) for i in range(10)]
    labels = [NORMAL] * 7 + [ABNORMAL] * 3
    truth = [(s, e, l) for (s, e), l in zip(spans, labels)]
    predicted = [(s, e, l) for (s, e), l in zip(spans, [NORMAL] * 10)]
    assert iou_weighted_f1(truth, predicted) == pytest.approx(0.7)


# -- ACV: rank decay ------------------------------------------------------
@pytest.mark.parametrize("position,expected", [(1, 1.0), (2, 0.875), (3, 0.75), (8, 0.125)])
def test_rank_decay_matches_the_info_kit_table(position, expected):
    cars = [f"{i:02d}" for i in range(1, 9)]
    assert rank_decay_score(cars, cars[position - 1]) == pytest.approx(expected)


def test_unranked_car_scores_zero():
    assert rank_decay_score([f"{i:02d}" for i in range(1, 9)], "99") == 0.0
    assert rank_decay_score([], "01") == 0.0
