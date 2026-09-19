"""Plain-language names for the engineered features.

Feature names are built to be machine-readable and systematic
(``contrast__vib__wlfrac2__mean``), which is right for the model but useless to
a maintainer reading a result screen. This module turns them back into English
so an explanation reads "Side I vs Side II difference in the 8-16 cm wavelength
energy share is too high" rather than a column name and a float.

Nothing here changes what the model does. The exact rule, threshold and
contribution are always kept alongside the readable text, so the precise form
stays available for anyone who wants it.
"""

from __future__ import annotations

import re

#: Wavelength band edges in metres, matching FeatureConfig.wavelength_bands_m.
#: Rail corrugation is a fixed-wavelength phenomenon, so naming the actual band
#: is far more meaningful than saying "band 2".
_BAND_EDGES_CM = (2, 4, 8, 16, 32, 64)


def _band_label(index: int) -> str:
    if 0 <= index < len(_BAND_EDGES_CM) - 1:
        return f"{_BAND_EDGES_CM[index]}-{_BAND_EDGES_CM[index + 1]} cm"
    return f"band {index}"


# Rail: {scope}__{signal}__{metric}__{stat}
_SCOPE = {
    "self": "this rail's",
    "other": "the opposite rail's",
    "contrast": "Side I vs Side II difference in",
    "sideI": "the Side I rail's",
    "sideII": "the Side II rail's",
}
_SIGNAL = {"vib": "vibration", "shock": "shock"}
_STAT = {
    "mean": "averaged over the axle boxes",
    "median": "median over the axle boxes",
    "p90": "90th percentile over the axle boxes",
    "max": "worst axle box",
    "std": "spread across the axle boxes",
}
_METRIC = {
    "rms": "level (RMS)",
    "peak": "peak level",
    "p2p": "peak-to-peak level",
    "std": "variability",
    "kurtosis": "impulsiveness (kurtosis)",
    "skewness": "asymmetry (skew)",
    "crest": "crest factor",
    "shape": "shape factor",
    "impulse": "impulse factor",
    "clearance": "clearance factor",
    "zcr": "zero-crossing rate",
    "sp_centroid_hz": "spectral centre frequency",
    "sp_spread_hz": "spectral spread",
    "sp_entropy": "spectral disorder",
    "sp_flatness": "spectral flatness",
    "sp_rolloff95_hz": "95% spectral roll-off",
    "wl_centroid_m": "dominant wear wavelength",
    "wl_peak_m": "peak wear wavelength",
    "wl_entropy": "spread of energy across wavelengths",
    "wl_flatness": "flatness across wavelengths",
}

# Door
_DOOR = {
    "n_rows": "number of samples in the cycle",
    "duration_s": "cycle duration",
    "cur_mean": "average motor current",
    "cur_max": "peak motor current",
    "cur_std": "motor current variability",
    "cur_p75": "upper-quartile motor current",
    "cur_p90": "90th-percentile motor current",
    "cur_median": "median motor current",
    "cur_integral": "total charge drawn over the stroke",
    "volt_mean": "average motor voltage",
    "emf_mean": "average back-EMF",
    "emf_max": "peak back-EMF",
    "pos_range": "door travel range",
    "pos_travel": "total leaf travel",
    "pos_start": "starting leaf position",
    "pos_end": "ending leaf position",
    "cur_per_travel": "current drawn per unit of door travel (effort against resistance)",
    "cur_over_emf": "current relative to back-EMF (motor torque per unit speed)",
    "cur_over_volt": "current relative to voltage",
    "speed_mean": "average door speed",
    "cur_phase_argmax": "where in the stroke current peaks",
    "cur_phase_spread": "unevenness of current across the stroke",
}

# SHM
_SHM = {
    "n_samples": "number of samples",
    "n_cycles": "number of rainflow stress cycles",
    "rms": "stress level (RMS)",
    "std": "stress variability",
    "peak": "peak stress",
    "range": "total stress range",
    "kurtosis": "stress impulsiveness (kurtosis)",
    "amp_mean": "average cycle amplitude",
    "amp_max": "largest cycle amplitude",
    "amp_p99": "99th-percentile cycle amplitude",
    "amp_p90": "90th-percentile cycle amplitude",
    "amp_std": "spread of cycle amplitudes",
}

# ACV
_ACV_BASE = {
    "indoor_mean": "average cabin temperature",
    "indoor_std": "cabin temperature variability",
    "indoor_max": "peak cabin temperature",
    "indoor_slope": "cabin temperature drift over the run",
    "shortfall_mean": "how far the cabin sits above its cooling setpoint",
    "frac_above_setpoint": "share of time above the cooling setpoint",
    "outdoor_mean": "average outside temperature",
    "mode_nunique": "number of distinct running modes",
    "mode_changes": "number of running-mode changes",
}
_ACV_PREFIX = {
    "dev": "{} compared with the rest of the fleet",
    "z": "{}, as a z-score against the fleet",
    "rank": "this car's rank among the eight for {}",
}


def describe_feature(name: str) -> str:
    """Best-effort plain-language name; falls back to the raw name."""
    # Rail: four-part scope__signal__metric__stat
    if "__" in name:
        parts = name.split("__")
        if len(parts) == 4:
            scope, signal, metric, stat = parts
            metric_text = _metric_text(metric)
            return (
                f"{_SCOPE.get(scope, scope)} {_SIGNAL.get(signal, signal)} "
                f"{metric_text} ({_STAT.get(stat, stat)})"
            )
        return name

    if name in _DOOR:
        return _DOOR[name]
    if name in _SHM:
        return _SHM[name]

    # Door's per-phase current profile.
    phase = re.fullmatch(r"cur_phase(\d+)", name)
    if phase:
        return f"motor current in stroke phase {int(phase.group(1)) + 1} of 8"

    # SHM's Miner stress moments.
    moment = re.fullmatch(r"log_S(\d+(?:\.\d+)?)", name)
    if moment:
        return f"accumulated stress moment at exponent m={moment.group(1)} (the Miner's-rule term)"

    # ACV's fleet-relative wrappers.
    for prefix, template in _ACV_PREFIX.items():
        if name.startswith(prefix + "_"):
            inner = name[len(prefix) + 1 :]
            if inner in _ACV_BASE:
                return template.format(_ACV_BASE[inner])
    if name in _ACV_BASE:
        return _ACV_BASE[name]

    if name == "is_stationary":
        return "the train was stationary"
    return name


def _metric_text(metric: str) -> str:
    if metric in _METRIC:
        return _METRIC[metric]
    fraction = re.fullmatch(r"wlfrac(\d+)", metric)
    if fraction:
        return f"share of energy at {_band_label(int(fraction.group(1)))} wavelength"
    absolute = re.fullmatch(r"wlabs(\d+)", metric)
    if absolute:
        return f"energy at {_band_label(int(absolute.group(1)))} wavelength"
    return metric


def describe_condition(feature: str, direction: str) -> str:
    """Render a split as a plain statement, e.g. "... is too high"."""
    magnitude = "too high" if direction == ">" else "too low"
    return f"{describe_feature(feature)} is {magnitude}"
