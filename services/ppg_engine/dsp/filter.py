"""
Butterworth bandpass filtering (MOD-04 DSP).

Applies a zero-phase Butterworth bandpass filter (0.7-3.5 Hz) to remove
baseline wander and high-frequency noise from the raw camera-PPG waveform.
"""

from typing import Tuple

import numpy as np
from scipy.signal import butter, sosfiltfilt

BANDPASS_LOW_HZ = 0.7
BANDPASS_HIGH_HZ = 3.5
BUTTERWORTH_ORDER = 3


def clamp_bandpass_to_nyquist(sampling_rate_hz: float) -> Tuple[float, float]:
    """Returns the usable bandpass edges given the Nyquist limit (fs/2)."""
    nyquist_hz = sampling_rate_hz / 2.0
    low = min(BANDPASS_LOW_HZ, nyquist_hz * 0.9)
    high = min(BANDPASS_HIGH_HZ, nyquist_hz * 0.95)
    if low >= high:
        raise ValueError("Sampling rate too low for PPG bandpass filtering.")
    return low, high


def butterworth_bandpass(
    signal: np.ndarray,
    sampling_rate_hz: float,
    low_hz: float = BANDPASS_LOW_HZ,
    high_hz: float = BANDPASS_HIGH_HZ,
    order: int = BUTTERWORTH_ORDER,
) -> np.ndarray:
    """
    Zero-phase Butterworth bandpass filter via forward-backward application
    (scipy filtfilt), preserving cardiac peak timing.
    """
    if sampling_rate_hz / 2.0 <= low_hz:
        raise ValueError(
            f"Nyquist limit {sampling_rate_hz / 2.0:.2f} Hz must exceed low cutoff {low_hz} Hz."
        )

    low, high = clamp_bandpass_to_nyquist(sampling_rate_hz)
    nyquist_hz = sampling_rate_hz / 2.0
    sos = butter(order, [low / nyquist_hz, high / nyquist_hz], btype="bandpass", output="sos")

    # Padding must exceed the filter transient for filtfilt stability
    padlen = min(len(signal) - 1, 3 * max(len(sos), order) + 1)
    if padlen < 1:
        raise ValueError("Signal too short for bandpass filtering.")

    filtered = sosfiltfilt(sos, np.asarray(signal, dtype=float), padlen=padlen)
    return filtered
