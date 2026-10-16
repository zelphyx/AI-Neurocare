"""
Template-matching Signal Quality Index (MOD-04 DSP).

Builds a median cardiac beat template from detected peaks and scores every
beat by its Pearson correlation against the template. The mean correlation is
the SQI in [0, 1]. SQI < 0.45 triggers an absolute rejection of the recording.
"""

from typing import List

import numpy as np

# Calibrated on the BUT PPG smartphone dataset (MOD-04): template-matching SQI
# runs lower on real smartphone photoplethysmograms than on synthetic signals
# because beat morphology naturally varies. 0.45 separates the dataset's own
# quality-1 clips from its quality-0 clips (only 1/13 low-quality clips leak
# through) while keeping 69% coverage of the trustworthy clips.
SQI_REJECTION_THRESHOLD = 0.45
TEMPLATE_LENGTH_SAMPLES = 100


def build_beat_segments(
    filtered_signal: np.ndarray,
    peaks: np.ndarray,
    sampling_rate_hz: float,
    template_length: int = TEMPLATE_LENGTH_SAMPLES,
) -> List[np.ndarray]:
    """
    Extracts beat-by-beat segments centered on each detected systolic peak and
    resamples them to a fixed length for template comparison.
    """
    segments: List[np.ndarray] = []
    half_window_s = 0.5 * (60.0 / 40.0)  # half of the longest plausible beat (0.75 s)
    half_window = int(half_window_s * sampling_rate_hz)

    for peak in peaks:
        start = peak - half_window
        end = peak + half_window
        if start < 0 or end >= len(filtered_signal):
            continue
        segment = filtered_signal[start:end]
        if len(segment) < 2:
            continue
        resampled = np.interp(
            np.linspace(0.0, 1.0, template_length),
            np.linspace(0.0, 1.0, len(segment)),
            segment,
        )
        segments.append(resampled)

    return segments


def compute_ibi_regularity(ibi_ms_list: List[float]) -> float:
    """
    Scores inter-beat interval regularity as max(0, 1 - 2*CV).
    A healthy stationary recording has a small coefficient of variation;
    motion corruption scatters the intervals and drives this toward 0.
    """
    if len(ibi_ms_list) < 3:
        return 0.0
    intervals = np.asarray(ibi_ms_list, dtype=float)
    mean_ibi = float(intervals.mean())
    if mean_ibi <= 0.0:
        return 0.0
    cv = float(intervals.std()) / mean_ibi
    return round(max(0.0, 1.0 - 2.0 * cv), 4)


def compute_template_matching_sqi(
    filtered_signal: np.ndarray,
    peaks: np.ndarray,
    sampling_rate_hz: float,
    ibi_ms_list: List[float] | None = None,
) -> float:
    """
    Computes the combined SQI: template-matching beat correlation multiplied by
    inter-beat-interval regularity. Requires at least 3 aligned beats; fewer
    beats yields SQI 0.0 (the recording cannot be trusted).
    """
    segments = build_beat_segments(filtered_signal, peaks, sampling_rate_hz)
    if len(segments) < 3:
        return 0.0

    template = np.median(np.vstack(segments), axis=0)
    template_centered = template - template.mean()
    template_norm = np.linalg.norm(template_centered)
    if template_norm == 0.0:
        return 0.0

    correlations: List[float] = []
    for segment in segments:
        centered = segment - segment.mean()
        norm = np.linalg.norm(centered)
        if norm == 0.0:
            continue
        correlation = float(np.dot(centered, template_centered) / (norm * template_norm))
        correlations.append(correlation)

    if len(correlations) < 3:
        return 0.0

    correlation_sqi = min(1.0, max(0.0, float(np.mean(correlations))))

    if ibi_ms_list is None:
        from dsp.peaks import compute_ibi_ms  # local import avoids a cycle
        ibi_ms_list = compute_ibi_ms(peaks, sampling_rate_hz)
    regularity = compute_ibi_regularity(ibi_ms_list)

    sqi = correlation_sqi * regularity
    return round(min(1.0, max(0.0, sqi)), 4)
