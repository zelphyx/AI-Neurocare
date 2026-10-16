"""
Pydantic Schemas for the Camera PPG Processing Microservice (MOD-04).
Request/response contracts and RFC 7807 Problem Details error payloads.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class PpgProcessRequest(BaseModel):
    """Request payload for the POST /api/v1/biomarkers/ppg/process endpoint."""

    signal: List[float] = Field(
        ...,
        min_length=32,
        max_length=100_000,
        description="Raw PPG waveform samples (camera-derived, unitless intensity values).",
    )
    samplingRateHz: float = Field(
        ...,
        ge=10.0,
        le=240.0,
        description="Sampling frequency of the PPG signal in Hz (camera: 25-60 Hz).",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "signal": [0.42, 0.45, 0.51],
                    "samplingRateHz": 30.0,
                }
            ]
        }
    }


class ProcessingMeta(BaseModel):
    """Deterministic processing metadata."""

    filteredSamples: int
    detectedBeats: int
    dspVersion: str = "1.0.0"


class PpgBiomarkerResponse(BaseModel):
    """Successful (or deterministically rejected) PPG processing result."""

    status: Literal["PROCESSED", "REJECTED"]
    heartRateBpm: Optional[float] = Field(
        default=None, description="Estimated heart rate from median inter-beat interval."
    )
    sqi: float = Field(..., ge=0.0, le=1.0, description="Signal Quality Index [0..1].")
    ibiMsList: Optional[List[float]] = Field(
        default=None, description="Inter-beat intervals in milliseconds."
    )
    rejectionReason: Optional[
        Literal["EXCESSIVE_MOTION", "SIGNAL_TOO_SHORT", "INSUFFICIENT_BEATS"]
    ] = None
    processingMeta: ProcessingMeta


class ProblemDetails(BaseModel):
    """RFC 7807 Problem Details for all 4xx/5xx error responses."""

    type: str = "https://errors.ai-neurocare.org/v1/ppg-processing-error"
    title: str
    status: int = Field(..., ge=400, le=599)
    detail: str
    instance: str
    errorCode: str
    timestamp: str
