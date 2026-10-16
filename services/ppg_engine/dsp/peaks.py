"""
Peak detection and inter-beat interval estimation (MOD-04 DSP).
"""

from typing import List, Tuple

import numpy as np
from scipy.signal import find_peaks

MIN_HEART_RATE_BPM = 40
MAX_HEART_RATE_BPM = 200


def detect_systolic_peaks(filtered_signal: np.ndarray, sampling_rate_hz: float) -> np.ndarray:
    """
    Detects systolic peaks on the filtered PPG waveform.

    Peak distance is constrained to the physiologically plausible cardiac band
    (40-200 BPM => 0.3-1.5 s between beats); prominence adapts to signal scale.
    """
    if len(filtered_signal) < 8:
        return np.array([], dtype=int)

    signal_std = float(np.std(filtered_signal))
    if signal_std == 0.0:
        return np.array([], dtype=int)

    min_interval_s = 60.0 / MAX_HEART_RATE_BPM
    min_distance = max(1, int(min_interval_s * sampling_rate_hz))

    height = 0.4 * float(np.max(np.abs(filtered_signal)))

    peaks, _ = find_peaks(
        filtered_signal,
        distance=min_distance,
        prominence=0.3 * signal_std,
        height=height,
    )
    return peaks


def compute_ibi_ms(peaks: np.ndarray, sampling_rate_hz: float) -> List[float]:
    """Computes inter-beat intervals in milliseconds from detected peak indices."""
    if len(peaks) < 2:
        return []
    intervals_samples = np.diff(peaks).astype(float)
    return [round((n / sampling_rate_hz) * 1000.0, 3) for n in intervals_samples]


def estimate_bpm_from_median_ibi(ibi_ms_list: List[float]) -> Tuple[float, float]:
    """
    Estimates BPM from the median inter-beat interval.

    Returns (bpm, median_ibi_ms). Raises ValueError when no intervals exist.
    """
    if len(ibi_ms_list) == 0:
        raise ValueError("No inter-beat intervals available for BPM estimation.")
    median_ibi_ms = float(np.median(np.asarray(ibi_ms_list)))
    if median_ibi_ms <= 0.0:
        raise ValueError("Median inter-beat interval must be positive.")
    bpm = 60000.0 / median_ibi_ms
    return round(bpm, 2), round(median_ibi_ms, 3)
