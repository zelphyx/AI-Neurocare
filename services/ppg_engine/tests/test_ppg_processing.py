"""
Test suite for the Camera PPG Monitoring Engine (MOD-04 Checkpoint 20).
Covers TC-PPG-001 through TC-PPG-008 including the BUT PPG calibration
benchmark (MAE <= 5.0 BPM) against synthetic reference signals.
"""

import math

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import app
from core import process_ppg_signal
from dsp.filter import butterworth_bandpass
from dsp.peaks import compute_ibi_ms, detect_systolic_peaks, estimate_bpm_from_median_ibi
from dsp.quality import SQI_REJECTION_THRESHOLD, compute_template_matching_sqi
from schemas import PpgProcessRequest

client = TestClient(app)

PROCESS_URL = "/api/v1/biomarkers/ppg/process"
SAMPLING_RATE_HZ = 50.0
RECORD_SECONDS = 30.0


def synth_ppg(bpm: float, seconds: float = RECORD_SECONDS, noise_std: float = 0.01,
              motion_artifact: bool = False, seed: int = 42) -> np.ndarray:
    """Synthetic PPG waveform: cardiac fundamental + harmonic + optional artifacts."""
    rng = np.random.default_rng(seed)
    f_hz = bpm / 60.0
    t = np.arange(int(seconds * SAMPLING_RATE_HZ)) / SAMPLING_RATE_HZ
    waveform = (
        np.sin(2 * math.pi * f_hz * t)
        + 0.35 * np.sin(4 * math.pi * f_hz * t + 0.7)
        + 0.12 * np.sin(6 * math.pi * f_hz * t + 1.3)
    )
    waveform += rng.normal(0.0, noise_std, size=len(t))
    if motion_artifact:
        # In-band random noise (survives the 0.7-3.5 Hz bandpass, corrupts beat
        # shapes). Normalized to unit std so the corruption amplitude is explicit.
        in_band_noise = butterworth_bandpass(rng.normal(0.0, 1.0, size=len(t)), SAMPLING_RATE_HZ)
        waveform += (in_band_noise / np.std(in_band_noise)) * 1.5
        # Low-frequency baseline wander (user movement)
        waveform += 2.5 * np.sin(2 * math.pi * 0.25 * t) * rng.uniform(0.8, 1.2)
    return waveform


def process_array(signal: np.ndarray, sampling_rate_hz: float = SAMPLING_RATE_HZ) -> dict:
    request = PpgProcessRequest(signal=signal.tolist(), samplingRateHz=sampling_rate_hz)
    return process_ppg_signal(request).model_dump()


# =============================================================================
# TC-PPG-001: clean synthetic signal yields accurate BPM
# =============================================================================

def test_tc_ppg_001_clean_signal_bpm_accuracy():
    response = process_array(synth_ppg(72.0, seed=7))
    assert response["status"] == "PROCESSED"
    assert response["rejectionReason"] is None
    assert response["heartRateBpm"] == pytest.approx(72.0, abs=3.0)
    assert response["sqi"] >= SQI_REJECTION_THRESHOLD


# =============================================================================
# TC-PPG-002: noisy / motion-corrupted signal is absolutely rejected
# =============================================================================

def test_tc_ppg_002_excessive_motion_rejection():
    response = process_array(synth_ppg(72.0, motion_artifact=True, seed=11))
    assert response["status"] == "REJECTED"
    assert response["rejectionReason"] == "EXCESSIVE_MOTION"
    assert response["sqi"] < SQI_REJECTION_THRESHOLD
    # Absolute rejection: no biomarker may be returned
    assert response["heartRateBpm"] is None
    assert response["ibiMsList"] is None


# =============================================================================
# TC-PPG-003: SQI gate boundary — SQI below the rejection threshold is a hard
# rejection (threshold calibrated on the BUT PPG real dataset, MOD-04)
# =============================================================================

def test_tc_ppg_003_sqi_threshold_is_absolute():
    assert SQI_REJECTION_THRESHOLD == 0.45
    good = process_array(synth_ppg(80.0, noise_std=0.005, seed=3))
    assert good["sqi"] >= SQI_REJECTION_THRESHOLD
    assert good["status"] == "PROCESSED"

    bad = process_array(synth_ppg(80.0, noise_std=0.28, motion_artifact=True, seed=5))
    assert bad["sqi"] < SQI_REJECTION_THRESHOLD
    assert bad["status"] == "REJECTED"


# =============================================================================
# TC-PPG-004: too-short recording is rejected as SIGNAL_TOO_SHORT
# =============================================================================

def test_tc_ppg_004_signal_too_short_rejection():
    response = process_array(synth_ppg(70.0, seconds=2.0))
    assert response["status"] == "REJECTED"
    assert response["rejectionReason"] == "SIGNAL_TOO_SHORT"
    assert response["heartRateBpm"] is None


# =============================================================================
# TC-PPG-005: median-IBI computation and BPM conversion are deterministic
# =============================================================================

def test_tc_ppg_005_median_ibi_bpm_determinism():
    filtered = butterworth_bandpass(synth_ppg(75.0, seed=9), SAMPLING_RATE_HZ)
    peaks = detect_systolic_peaks(filtered, SAMPLING_RATE_HZ)
    ibi_ms = compute_ibi_ms(peaks, SAMPLING_RATE_HZ)

    assert len(ibi_ms) >= 5
    bpm, median_ibi = estimate_bpm_from_median_ibi(ibi_ms)
    assert median_ibi == pytest.approx(800.0, abs=60.0)  # 75 BPM -> 800 ms
    assert bpm == pytest.approx(75.0, abs=5.0)
    # Determinism: identical input yields identical output
    bpm2, median_ibi2 = estimate_bpm_from_median_ibi(ibi_ms)
    assert (bpm, median_ibi) == (bpm2, median_ibi2)


# =============================================================================
# TC-PPG-006: HTTP contract — valid request returns 200 PROCESSED
# =============================================================================

def test_tc_ppg_006_http_processed_response_contract():
    payload = {
        "signal": synth_ppg(68.0, seed=13).tolist(),
        "samplingRateHz": SAMPLING_RATE_HZ,
    }
    res = client.post(PROCESS_URL, json=payload)

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "PROCESSED"
    assert set(body.keys()) == {
        "status", "heartRateBpm", "sqi", "ibiMsList", "rejectionReason", "processingMeta"
    }
    assert body["processingMeta"]["dspVersion"] == "1.0.0"
    assert body["processingMeta"]["detectedBeats"] >= 5


# =============================================================================
# TC-PPG-007: HTTP error contract — invalid payload yields RFC 7807 422
# =============================================================================

def test_tc_ppg_007_http_rfc7807_validation_error():
    # samplingRateHz out of allowed range
    res = client.post(
        PROCESS_URL,
        json={"signal": [0.1, 0.2, 0.3] * 100, "samplingRateHz": 500.0},
    )
    assert res.status_code == 422
    problem = res.json()
    assert problem["title"] == "Request Validation Error"
    assert problem["status"] == 422
    assert problem["type"].startswith("https://errors.ai-neurocare.org/")
    assert problem["errorCode"] == "ERR_PPG_REQUEST_VALIDATION_FAILED"
    assert problem["instance"] == PROCESS_URL
    assert "timestamp" in problem

    # Missing field entirely
    res2 = client.post(PROCESS_URL, json={"signal": [0.1, 0.2, 0.3]})
    assert res2.status_code == 422
    assert res2.json()["errorCode"] == "ERR_PPG_REQUEST_VALIDATION_FAILED"


# =============================================================================
# TC-PPG-008: BUT PPG calibration benchmark — MAE <= 5.0 BPM across HR range
# =============================================================================

def test_tc_ppg_008_benchmark_mae_within_5_bpm():
    reference_bpms = [55.0, 60.0, 68.0, 72.0, 80.0, 90.0, 100.0, 110.0, 120.0]
    errors = []

    for bpm in reference_bpms:
        response = process_array(synth_ppg(bpm, noise_std=0.02, seed=int(bpm)))
        assert response["status"] == "PROCESSED", f"signal at {bpm} BPM was rejected"
        errors.append(abs(response["heartRateBpm"] - bpm))

    mae = float(np.mean(errors))
    max_error = float(np.max(errors))
    print(f"[Benchmark] BUT PPG calibration: MAE={mae:.3f} BPM, max={max_error:.3f} BPM "
          f"over {len(reference_bpms)} references (target MAE <= 5.0)")

    assert mae <= 5.0
    assert max_error <= 8.0


# =============================================================================
# Edge: sampling-rate domain error surfaces as RFC 7807 422
# =============================================================================

def test_low_sampling_rate_domain_error_is_rfc7807():
    # 5 Hz is below the schema floor (ge=10) -> RFC 7807 validation problem
    res = client.post(
        PROCESS_URL,
        json={"signal": [0.1] * 512, "samplingRateHz": 5.0},
    )
    assert res.status_code == 422
    problem = res.json()
    assert problem["errorCode"] == "ERR_PPG_REQUEST_VALIDATION_FAILED"
    assert problem["title"] == "Request Validation Error"


# =============================================================================
# Edge: flatline signal has zero quality and is rejected
# =============================================================================

def test_flatline_signal_rejected():
    response = process_array(np.zeros(int(RECORD_SECONDS * SAMPLING_RATE_HZ)))
    assert response["status"] == "REJECTED"
    assert response["rejectionReason"] in {"INSUFFICIENT_BEATS", "EXCESSIVE_MOTION"}
