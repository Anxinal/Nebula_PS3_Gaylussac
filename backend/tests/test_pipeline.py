"""Unit tests for the parts that are easy to get quietly wrong."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rail_cdm import signal_features as sf
from rail_cdm.config import SIDE_OF_POSITION, FAULT_SIDE_OF_LABEL
from rail_cdm.dataloader import RailDataLoader, channel_column, side_channel_columns
from rail_cdm.evaluator import RailEvaluator


# -- channel mapping ------------------------------------------------------
def test_channel_column_matches_documented_layout():
    assert channel_column(1, 1, "vib") == 0
    assert channel_column(1, 1, "shock") == 1
    assert channel_column(1, 8, "shock") == 15
    assert channel_column(2, 1, "vib") == 16
    assert channel_column(8, 8, "shock") == 127


def test_sides_partition_all_64_axle_boxes():
    for signal in ("vib", "shock"):
        side_i = side_channel_columns("I", signal)
        side_ii = side_channel_columns("II", signal)
        assert len(side_i) == len(side_ii) == 32
        assert set(side_i).isdisjoint(side_ii)


def test_odd_positions_are_side_one():
    assert [p for p, s in SIDE_OF_POSITION.items() if s == "I"] == [1, 3, 5, 7]
    assert [p for p, s in SIDE_OF_POSITION.items() if s == "II"] == [2, 4, 6, 8]


# -- speed ----------------------------------------------------------------
def test_speed_from_pulse_train():
    # 90 teeth -> 180 level changes is exactly one revolution per second.
    pulses = np.tile([0, 1], 90)
    signal = np.repeat(pulses, 10000 // pulses.size)
    speed = sf.estimate_speed_ms(signal, fs=10000.0)
    assert speed == pytest.approx(np.pi * 0.85, rel=0.02)


def test_stationary_signal_reports_zero_speed():
    assert sf.estimate_speed_ms(np.ones(10000)) == 0.0


# -- wavelength features are the speed defence ----------------------------
@pytest.mark.parametrize("speed", [8.0, 14.0, 20.0])
def test_corrugation_lands_in_same_wavelength_band_at_any_speed(speed):
    """A 10 cm wear pattern must look identical however fast the train runs."""
    fs, wavelength = 10000.0, 0.10
    t = np.arange(int(fs)) / fs
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.5, t.size) + 3 * np.sin(2 * np.pi * (speed / wavelength) * t)
    freqs, psd = sf.welch_psd(x, fs=fs)
    feats = sf.wavelength_band_features(freqs, psd, speed, (0.02, 0.04, 0.08, 0.16, 0.32, 0.64))
    assert feats["wl_peak_m"] == pytest.approx(np.sqrt(0.08 * 0.16), rel=1e-6)
    assert feats["wlfrac2"] > 0.8


def test_wavelength_features_zero_when_stationary():
    freqs, psd = sf.welch_psd(np.random.default_rng(0).normal(0, 1, 10000))
    feats = sf.wavelength_band_features(freqs, psd, 0.0, (0.02, 0.04, 0.08, 0.16), min_speed_ms=1.0)
    assert all(v == 0.0 for v in feats.values())


def test_band_fractions_sum_to_one():
    freqs, psd = sf.welch_psd(np.random.default_rng(1).normal(0, 1, 10000))
    feats = sf.wavelength_band_features(freqs, psd, 14.0, (0.02, 0.04, 0.08, 0.16, 0.32, 0.64))
    assert sum(feats[f"wlfrac{i}"] for i in range(5)) == pytest.approx(1.0, abs=1e-6)


# -- contrast -------------------------------------------------------------
def test_contrast_is_antisymmetric():
    assert sf.contrast_value(4.0, 2.0, "rms") == pytest.approx(-sf.contrast_value(2.0, 4.0, "rms"))
    assert sf.contrast_value(3.0, 3.0, "rms") == pytest.approx(0.0)


def test_contrast_cancels_a_shared_scale_factor():
    """Speed scales both rails equally, so the contrast must not move."""
    base = sf.contrast_value(0.5, 0.4, "rms")
    for gain in (2.0, 10.0, 0.1):
        assert sf.contrast_value(0.5 * gain, 0.4 * gain, "rms") == pytest.approx(base)


def test_sign_valued_features_use_a_difference():
    assert sf.contrast_value(-1.0, 2.0, "kurtosis") == pytest.approx(-3.0)


# -- side frame -----------------------------------------------------------
def _toy_file_frame():
    return pd.DataFrame({
        "file_id": ["a.csv", "b.csv", "c.csv"],
        "label": ["Normal", "Side I", "Side II"],
        "speed_ms": [12.0, 13.0, 14.0],
        "is_stationary": [0.0, 0.0, 0.0],
        "sideI__vib__rms__mean": [1.0, 2.0, 1.0],
        "sideII__vib__rms__mean": [1.0, 1.0, 2.0],
        "contrast__vib__rms__mean": [0.0, 0.69, -0.69],
    })


def test_side_frame_targets_follow_the_label():
    side = RailDataLoader.to_side_frame(_toy_file_frame())
    assert len(side) == 6
    got = {(r.file_id, r.side): r.target for r in side.itertuples()}
    assert got[("a.csv", "I")] == 0 and got[("a.csv", "II")] == 0
    assert got[("b.csv", "I")] == 1 and got[("b.csv", "II")] == 0
    assert got[("c.csv", "I")] == 0 and got[("c.csv", "II")] == 1


def test_side_frame_flips_contrast_for_the_second_rail():
    side = RailDataLoader.to_side_frame(_toy_file_frame()).set_index(["file_id", "side"])
    for file_id in ("a.csv", "b.csv", "c.csv"):
        a = side.loc[(file_id, "I"), "contrast__vib__rms__mean"]
        b = side.loc[(file_id, "II"), "contrast__vib__rms__mean"]
        assert a == pytest.approx(-b)


def test_side_frame_orients_self_and_other():
    side = RailDataLoader.to_side_frame(_toy_file_frame()).set_index(["file_id", "side"])
    # b.csv has the louder rail on Side I
    assert side.loc[("b.csv", "I"), "self__vib__rms__mean"] == 2.0
    assert side.loc[("b.csv", "I"), "other__vib__rms__mean"] == 1.0
    assert side.loc[("b.csv", "II"), "self__vib__rms__mean"] == 1.0


def test_fault_side_mapping():
    assert FAULT_SIDE_OF_LABEL["Normal"] is None
    assert FAULT_SIDE_OF_LABEL["Side I"] == "I"
    assert FAULT_SIDE_OF_LABEL["Side II"] == "II"


# -- evaluator ------------------------------------------------------------
def test_macro_f1_matches_the_info_kit_worked_example():
    """Info Kit Section 4 averages per-class F1 unweighted."""
    ev = RailEvaluator()
    y_true = ["Normal"] * 8 + ["Side I"] * 2 + ["Side II"] * 2
    y_pred = ["Normal"] * 10 + ["Side II"] * 2
    report = ev.evaluate(y_true, y_pred)
    assert report.per_class.loc["Side I", "f1"] == 0.0
    assert report.per_class.loc["Side II", "f1"] == 1.0
    # per_class is rounded to 4 dp for display, so compare at that precision
    assert report.macro_f1 == pytest.approx(np.mean(report.per_class.f1), abs=1e-4)


def test_always_normal_scores_about_a_third():
    """The degenerate baseline the Info Kit warns about, on the real class counts.

    Normal F1 = 2*(234/272)/(1 + 234/272) = 0.9249, the two fault classes score
    0, so macro F1 = 0.3083 despite 86% plain accuracy.
    """
    ev = RailEvaluator()
    y_true = ["Normal"] * 234 + ["Side I"] * 14 + ["Side II"] * 24
    assert ev.macro_f1(y_true, ["Normal"] * len(y_true)) == pytest.approx(0.3083, abs=1e-3)


def test_pooling_statistics():
    values = np.array([1.0, 2.0, 3.0, 4.0])
    assert sf.pool(values, "mean") == 2.5
    assert sf.pool(values, "median") == 2.5
    assert sf.pool(values, "max") == 4.0
    assert sf.pool(values, "p90") == pytest.approx(3.7)
    with pytest.raises(ValueError):
        sf.pool(values, "nonsense")
