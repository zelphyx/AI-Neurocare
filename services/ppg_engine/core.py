"""
Core orchestration for the Camera PPG Monitoring Engine (MOD-04).

Pipeline: raw signal -> Butterworth bandpass (0.7-3.5 Hz, zero-phase)
-> systolic peak detection -> template-matching SQI -> deterministic gates
-> median-IBI BPM estimation.
"""

from typing import List

import numpy as np

from dsp.filter import butterworth_bandpass
from dsp.peaks import compute_ibi_ms, detect_systolic_peaks, estimate_bpm_from_median_ibi
from dsp.quality import SQI_REJECTION_THRESHOLD, compute_template_matching_sqi
from schemas import PpgBiomarkerResponse, PpgProcessRequest, ProcessingMeta

MIN_SIGNAL_DURATION_S = 5.0
MIN_DETECTED_BEATS = 5


def process_ppg_signal(request: PpgProcessRequest) -> PpgBiomarkerResponse:
    """
    Processes a raw PPG recording into heart-rate biomarkers with hard,
    deterministic quality gates:

    - SIGNAL_TOO_SHORT: recording shorter than MIN_SIGNAL_DURATION_S
    - INSUFFICIENT_BEATS: fewer than MIN_DETECTED_BEATS cardiac beats found
    - EXCESSIVE_MOTION: template-matching SQI below 0.60 (absolute rejection)

    Rejected recordings NEVER return a biomarker value.
    """
    signal = np.asarray(request.signal, dtype=float)
    sampling_rate_hz = float(request.samplingRateHz)
    duration_s = len(signal) / sampling_rate_hz

    if duration_s < MIN_SIGNAL_DURATION_S:
        return PpgBiomarkerResponse(
            status="REJECTED",
            sqi=0.0,
            rejectionReason="SIGNAL_TOO_SHORT",
            processingMeta=ProcessingMeta(
                filteredSamples=0, detectedBeats=0
            ),
        )

    filtered = butterworth_bandpass(signal, sampling_rate_hz)
    peaks = detect_systolic_peaks(filtered, sampling_rate_hz)
    sqi = compute_template_matching_sqi(filtered, peaks, sampling_rate_hz)

    if len(peaks) < MIN_DETECTED_BEATS:
        return PpgBiomarkerResponse(
            status="REJECTED",
            sqi=sqi,
            rejectionReason="INSUFFICIENT_BEATS",
            processingMeta=ProcessingMeta(
                filteredSamples=len(filtered), detectedBeats=len(peaks)
            ),
        )

    if sqi < SQI_REJECTION_THRESHOLD:
        return PpgBiomarkerResponse(
            status="REJECTED",
            sqi=sqi,
            rejectionReason="EXCESSIVE_MOTION",
            processingMeta=ProcessingMeta(
                filteredSamples=len(filtered), detectedBeats=len(peaks)
            ),
        )

    ibi_ms_list: List[float] = compute_ibi_ms(peaks, sampling_rate_hz)
    bpm, _median_ibi_ms = estimate_bpm_from_median_ibi(ibi_ms_list)

    return PpgBiomarkerResponse(
        status="PROCESSED",
        heartRateBpm=bpm,
        sqi=sqi,
        ibiMsList=ibi_ms_list,
        rejectionReason=None,
        processingMeta=ProcessingMeta(
            filteredSamples=len(filtered), detectedBeats=len(peaks)
        ),
    )
