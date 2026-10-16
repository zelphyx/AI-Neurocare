"""
Camera PPG Monitoring Engine FastAPI service (MOD-04).

Exposes POST /api/v1/biomarkers/ppg/process with RFC 7807 error contract.
"""

from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from core import process_ppg_signal
from schemas import PpgProcessRequest, ProblemDetails

APP_INSTANCE = "/api/v1/biomarkers/ppg/process"

app = FastAPI(
    title="AI-Neurocare PPG Engine",
    version="1.0.0",
    description="Camera PPG biomarker processing with deterministic quality gates.",
)


def problem_details(
    title: str,
    status: int,
    detail: str,
    error_code: str,
    instance: str = APP_INSTANCE,
) -> ProblemDetails:
    return ProblemDetails(
        title=title,
        status=status,
        detail=detail,
        instance=instance,
        errorCode=error_code,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Translates FastAPI/Pydantic request validation failures into RFC 7807."""
    body = exc.errors()
    first = body[0] if body else {}
    field = ".".join(str(p) for p in first.get("loc", []) if p != "body") or "body"
    problem = problem_details(
        title="Request Validation Error",
        status=422,
        detail=f"Payload tidak valid pada field '{field}': {first.get('msg', 'validation failed')}",
        error_code="ERR_PPG_REQUEST_VALIDATION_FAILED",
    )
    return JSONResponse(status_code=422, content=problem.model_dump())


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    """DSP-domain value errors (e.g. sampling rate below Nyquist) become RFC 7807 422."""
    problem = problem_details(
        title="PPG Processing Error",
        status=422,
        detail=str(exc),
        error_code="ERR_PPG_DSP_DOMAIN_ERROR",
    )
    return JSONResponse(status_code=422, content=problem.model_dump())


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    problem = problem_details(
        title="Internal Server Error",
        status=500,
        detail="Terjadi kesalahan internal pada PPG engine.",
        error_code="ERR_PPG_INTERNAL_ERROR",
    )
    return JSONResponse(status_code=500, content=problem.model_dump())


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ppg-engine", "version": "1.0.0"}


@app.post("/api/v1/biomarkers/ppg/process")
def process_ppg(request: PpgProcessRequest) -> dict:
    """Processes a raw camera-PPG recording into validated heart-rate biomarkers."""
    response = process_ppg_signal(request)
    return response.model_dump()
