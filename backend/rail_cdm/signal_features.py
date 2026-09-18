"""Signal processing for axle-box vibration and shock channels.

Everything here is a pure function of a raw array plus parameters, so each
piece can be unit-tested without touching the dataset.

The guiding idea is that rail corrugation is a *wavelength* phenomenon: a
periodic wear pattern of wavelength lambda excites the axle box at frequency
``f = v / lambda`` when the train passes at speed ``v``. Features computed in
the frequency domain therefore move as the train speeds up or slows down,
whereas features computed in the wavelength domain stay put. Since the fault
recordings in this dataset were all captured at high speed and many normal
ones were not, frequency-domain (or raw amplitude) features would let a model
learn "fast means faulty" - a shortcut that would not survive a held-out set
with a different speed mix.
"""

from __future__ import annotations

import numpy as np
from scipy import signal as sps
from scipy import stats as sstats

from .config import (
    SAMPLING_RATE_HZ,
    SPEED_WHEEL_DIAMETER_M,
    SPEED_WHEEL_TEETH,
)

_EPS = 1e-12


# --------------------------------------------------------------------------
# Speed
# --------------------------------------------------------------------------
def estimate_speed_ms(
    speed_channel: np.ndarray,
    *,
    fs: float = SAMPLING_RATE_HZ,
    teeth: int = SPEED_WHEEL_TEETH,
    wheel_diameter_m: float = SPEED_WHEEL_DIAMETER_M,
) -> float:
    """Recover train speed in m/s from the toothed-wheel pulse train.

    The sensor toggles between 0 and 1 as each of ``teeth`` teeth passes the
    detection point, so one tooth produces two level changes. Counting changes
    gives revolutions, and each revolution advances the train by one wheel
    circumference.
    """
    x = np.asarray(speed_channel, dtype=np.float64)
    if x.size < 2:
        return 0.0

    # Guard against a sensor that idles at a non-binary level.
    binarised = (x > (np.nanmin(x) + np.nanmax(x)) / 2.0).astype(np.int8)
    n_changes = int(np.count_nonzero(np.diff(binarised)))

    revolutions = n_changes / 2.0 / teeth
    distance_m = revolutions * np.pi * wheel_diameter_m
    duration_s = x.size / fs
    return float(distance_m / duration_s) if duration_s > 0 else 0.0


# --------------------------------------------------------------------------
# Time domain
# --------------------------------------------------------------------------
def time_domain_features(x: np.ndarray) -> dict[str, float]:
    """Classic vibration descriptors.

    ``rms``/``peak``/``p2p`` carry amplitude scale (and so track speed);
    the dimensionless ratios below do not, which is why they are the ones
    enabled by default.
    """
    x = np.asarray(x, dtype=np.float64)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return {k: 0.0 for k in
                ("rms", "peak", "p2p", "std", "kurtosis", "skewness",
                 "crest", "shape", "impulse", "clearance", "zcr")}

    abs_x = np.abs(x)
    rms = float(np.sqrt(np.mean(x * x)))
    peak = float(abs_x.max())
    mean_abs = float(abs_x.mean())
    # Square-root-of-amplitude mean, the denominator of the clearance factor.
    sra = float(np.mean(np.sqrt(abs_x)) ** 2)

    return {
        "rms": rms,
        "peak": peak,
        "p2p": float(x.max() - x.min()),
        "std": float(x.std()),
        # Kurtosis and crest factor both spike on impulsive, non-Gaussian
        # signals - the hallmark of periodic wheel-rail impacts.
        "kurtosis": float(sstats.kurtosis(x, fisher=True, bias=False)) if x.size > 3 else 0.0,
        "skewness": float(sstats.skew(x, bias=False)) if x.size > 2 else 0.0,
        "crest": peak / (rms + _EPS),
        "shape": rms / (mean_abs + _EPS),
        "impulse": peak / (mean_abs + _EPS),
        "clearance": peak / (sra + _EPS),
        "zcr": float(np.mean(np.diff(np.signbit(x)) != 0)),
    }


SCALE_FREE_TIME_KEYS = (
    "kurtosis", "skewness", "crest", "shape", "impulse", "clearance", "zcr",
)
SCALE_BEARING_TIME_KEYS = ("rms", "peak", "p2p", "std")


# --------------------------------------------------------------------------
# Spectral / wavelength domain
# --------------------------------------------------------------------------
def welch_psd(
    x: np.ndarray,
    *,
    fs: float = SAMPLING_RATE_HZ,
    nperseg: int = 2048,
    overlap: float = 0.5,
) -> tuple[np.ndarray, np.ndarray]:
    """Power spectral density via Welch's method."""
    x = np.asarray(x, dtype=np.float64)
    nperseg = int(min(nperseg, x.size))
    noverlap = int(nperseg * overlap)
    freqs, psd = sps.welch(
        x, fs=fs, nperseg=nperseg, noverlap=noverlap,
        window="hann", detrend="constant", scaling="density",
    )
    return freqs, psd


def wavelength_band_features(
    freqs: np.ndarray,
    psd: np.ndarray,
    speed_ms: float,
    band_edges_m: tuple[float, ...],
    *,
    min_speed_ms: float = 1.0,
) -> dict[str, float]:
    """Integrate spectral power into fixed *wavelength* bands.

    Each band ``[lambda_lo, lambda_hi]`` maps to the frequency window
    ``[v/lambda_hi, v/lambda_lo]``. Band powers are returned both as absolute
    energy and, more usefully, as a fraction of total in-band energy - the
    fractions describe the *shape* of the corrugation signature and are
    unaffected by how hard the axle box happens to be shaking.

    Below ``min_speed_ms`` there is no wheel-rail excitation to analyse, so all
    values come back as zero and the caller should rely on ``is_stationary``.
    """
    n_bands = len(band_edges_m) - 1
    names_frac = [f"wlfrac{i}" for i in range(n_bands)]
    names_abs = [f"wlabs{i}" for i in range(n_bands)]

    if speed_ms < min_speed_ms:
        out = {n: 0.0 for n in names_frac + names_abs}
        out["wl_centroid_m"] = 0.0
        out["wl_entropy"] = 0.0
        out["wl_peak_m"] = 0.0
        out["wl_flatness"] = 0.0
        return out

    band_power = np.zeros(n_bands, dtype=np.float64)
    for i in range(n_bands):
        lam_lo, lam_hi = band_edges_m[i], band_edges_m[i + 1]
        f_lo, f_hi = speed_ms / lam_hi, speed_ms / lam_lo
        mask = (freqs >= f_lo) & (freqs < f_hi)
        if np.any(mask):
            band_power[i] = float(np.trapezoid(psd[mask], freqs[mask]))

    total = float(band_power.sum())
    frac = band_power / (total + _EPS)

    out: dict[str, float] = {}
    for i in range(n_bands):
        out[names_abs[i]] = float(band_power[i])
        out[names_frac[i]] = float(frac[i])

    # Where in wavelength space the energy sits, and how concentrated it is.
    # A sharp peak at one wavelength is the corrugation signature; broadband
    # noise is not.
    band_centres = np.sqrt(np.asarray(band_edges_m[:-1]) * np.asarray(band_edges_m[1:]))
    out["wl_centroid_m"] = float((frac * band_centres).sum())
    out["wl_peak_m"] = float(band_centres[int(np.argmax(frac))])
    nz = frac[frac > 0]
    out["wl_entropy"] = float(-(nz * np.log(nz)).sum()) if nz.size else 0.0
    out["wl_flatness"] = float(
        np.exp(np.mean(np.log(frac + _EPS))) / (np.mean(frac) + _EPS)
    )
    return out


WAVELENGTH_SCALE_FREE_PREFIXES = ("wlfrac", "wl_centroid_m", "wl_entropy", "wl_peak_m", "wl_flatness")
WAVELENGTH_SCALE_PREFIXES = ("wlabs",)


def spectral_shape_features(freqs: np.ndarray, psd: np.ndarray) -> dict[str, float]:
    """Speed-agnostic descriptors of overall spectral shape."""
    total = float(psd.sum())
    if total <= 0 or freqs.size == 0:
        return {"sp_centroid_hz": 0.0, "sp_spread_hz": 0.0,
                "sp_entropy": 0.0, "sp_flatness": 0.0, "sp_rolloff95_hz": 0.0}

    p = psd / total
    centroid = float((freqs * p).sum())
    spread = float(np.sqrt(((freqs - centroid) ** 2 * p).sum()))
    nz = p[p > 0]
    entropy = float(-(nz * np.log(nz)).sum())
    flatness = float(np.exp(np.mean(np.log(psd + _EPS))) / (np.mean(psd) + _EPS))
    cumulative = np.cumsum(p)
    rolloff = float(freqs[int(np.searchsorted(cumulative, 0.95))]) if cumulative[-1] >= 0.95 else float(freqs[-1])
    return {
        "sp_centroid_hz": centroid,
        "sp_spread_hz": spread,
        "sp_entropy": entropy,
        "sp_flatness": flatness,
        "sp_rolloff95_hz": rolloff,
    }


SPECTRAL_SCALE_FREE_KEYS = (
    "sp_centroid_hz", "sp_spread_hz", "sp_entropy", "sp_flatness", "sp_rolloff95_hz",
)


def channel_features(
    x: np.ndarray,
    speed_ms: float,
    band_edges_m: tuple[float, ...],
    *,
    fs: float = SAMPLING_RATE_HZ,
    nperseg: int = 2048,
    overlap: float = 0.5,
    min_speed_ms: float = 1.0,
) -> dict[str, float]:
    """Full feature dictionary for one axle-box channel."""
    feats = time_domain_features(x)
    freqs, psd = welch_psd(x, fs=fs, nperseg=nperseg, overlap=overlap)
    feats.update(spectral_shape_features(freqs, psd))
    feats.update(
        wavelength_band_features(
            freqs, psd, speed_ms, band_edges_m, min_speed_ms=min_speed_ms
        )
    )
    return feats


def is_scale_free(feature_key: str) -> bool:
    """True if a per-channel feature key is invariant to overall amplitude."""
    if feature_key in SCALE_FREE_TIME_KEYS or feature_key in SPECTRAL_SCALE_FREE_KEYS:
        return True
    return feature_key.startswith(WAVELENGTH_SCALE_FREE_PREFIXES)


def pool(values: np.ndarray, stat: str) -> float:
    """Aggregate one feature across the axle boxes belonging to a side."""
    values = values[np.isfinite(values)]
    if values.size == 0:
        return 0.0
    if stat == "mean":
        return float(values.mean())
    if stat == "median":
        return float(np.median(values))
    if stat == "max":
        return float(values.max())
    if stat == "min":
        return float(values.min())
    if stat == "std":
        return float(values.std())
    if stat.startswith("p"):
        return float(np.percentile(values, float(stat[1:])))
    raise ValueError(f"unknown pooling statistic: {stat!r}")


# --------------------------------------------------------------------------
# Side contrast
# --------------------------------------------------------------------------
#: Features that can legitimately be negative, so a ratio is meaningless.
SIGN_VALUED_KEYS = ("kurtosis", "skewness")

#: How far a log-ratio is allowed to run before clipping, to stop a
#: near-zero denominator from producing an outlier the forest would split on.
LOG_RATIO_CLIP = 6.0


def contrast_value(a: float, b: float, key: str) -> float:
    """Contrast one side's pooled feature against the other's.

    For strictly non-negative features this is ``log(a / b)``, which is the
    right form for two reasons: it is symmetric (swapping the sides flips the
    sign) and, crucially, it is *scale free*. Both rails are measured in the
    same file at the same speed, so whatever multiplicative effect speed has on
    an amplitude feature divides out - which is what lets amplitude features
    such as RMS and per-band energy contribute here even though their absolute
    values are too speed-confounded to use directly.

    Features that take either sign fall back to a plain difference.
    """
    if key in SIGN_VALUED_KEYS:
        return float(a - b)
    ratio = np.log((abs(a) + _EPS) / (abs(b) + _EPS))
    return float(np.clip(ratio, -LOG_RATIO_CLIP, LOG_RATIO_CLIP))
