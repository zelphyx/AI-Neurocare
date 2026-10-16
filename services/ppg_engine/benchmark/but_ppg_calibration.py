"""
BUT PPG Real-Dataset Calibration (MOD-04).

Validates the deterministic PPG pipeline (Butterworth 0.7-3.5 Hz zero-phase,
template-matching SQI, median-IBI BPM) against the public Brno University of
Technology Smartphone PPG Database (BUT PPG, PhysioNet, v1.0.0):

    Smíšek et al., "BUT PPG: A smartphone PPG database" (2020).
    https://physionet.org/content/butppg/1.0.0/

Reference heart rates come from quality-hr-ann.csv (ECG-referenced HR per
record). Each recording is a single 10-second clip at 30 Hz, so the whole
record is processed as one window.

Known dataset quirk (verified against both v1.0.0 and v2.0.0): the WFDB
headers of BUT PPG were written by a faulty converter — the `.dat` files
contain only zeros while the actual per-sample signal values were embedded in
the per-sample `.hea` signal lines (the varying gain field). load_record()
extracts those values, which yields a pulsatile waveform whose dominant FFT
frequency matches the ECG-referenced HR. Precision loss is ~0.1% of the AC
amplitude, immaterial for BPM estimation.

Usage (from services/ppg_engine):
    ./.venv/bin/python benchmark/but_ppg_calibration.py
"""

import csv
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# Make the engine package (core/, dsp/, schemas.py) importable when the script
# is executed from anywhere. The benchmark data directory itself is never on
# sys.path — it only ever contains downloaded PhysioNet data files.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import process_ppg_signal  # noqa: E402
from schemas import PpgProcessRequest  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent / "data" / "butppg"
ANN_CSV = Path(__file__).resolve().parent / "data" / "quality-hr-ann.csv"
RESULTS_JSON = Path(__file__).resolve().parent / "results_but_ppg.json"

WINDOW_SECONDS = 10.0
GAIN_LINE_RE = re.compile(r"^\S+\.dat\s+\d+\s+([-+\d.]+)\(")
MIN_QUALITY = 1  # quality-hr-ann.csv: 1 = acceptable/good quality annotation


def load_reference_annotations() -> dict[str, dict]:
    """Loads record-level reference HR + quality from quality-hr-ann.csv."""
    references: dict[str, dict] = {}
    with open(ANN_CSV, encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            references[str(row["ID"]).strip()] = {
                "quality": int(row["Quality"]),
                "reference_hr": float(row["HR"]),
            }
    return references


def record_path(subject_id: str) -> Path:
    return DATA_DIR / subject_id / f"{subject_id}_PPG"


def load_record(hea_path: Path) -> tuple[np.ndarray, float]:
    """
    Loads one BUT PPG record, working around the known header quirk.

    Extracts the per-sample values embedded in the .hea signal lines (the
    varying gain field) and returns (signal, fs). Falls back to wfdb only for
    the declared sampling frequency, so a future fixed release would still be
    readable by removing the extraction path.
    """
    import wfdb

    lines = hea_path.read_text(encoding="utf-8", errors="replace").splitlines()
    first = lines[0].split()
    n_samples = int(first[1])
    fs = float(first[2])

    values: list[float] = []
    for line in lines[1:]:
        if not line.endswith(".dat") and ".dat" not in line:
            continue
        match = GAIN_LINE_RE.match(line)
        if match:
            values.append(float(match.group(1)))
        if len(values) >= n_samples:
            break

    if len(values) < n_samples:
        raise ValueError(
            f"header quirk extraction incomplete: {len(values)}/{n_samples} samples"
        )
    return np.asarray(values, dtype=float), fs


def evaluate_windows(signal: np.ndarray, fs: float) -> list[dict]:
    """Runs the deterministic pipeline over sliding windows of the recording."""
    window_len = int(WINDOW_SECONDS * fs)
    step_len = max(1, window_len // 2)
    results: list[dict] = []

    for start in range(0, len(signal) - window_len + 1, step_len):
        window = signal[start : start + window_len]
        response = process_ppg_signal(
            PpgProcessRequest(signal=window.tolist(), samplingRateHz=fs)
        ).model_dump()
        results.append(
            {
                "start_s": start / fs,
                "status": response["status"],
                "bpm": response["heartRateBpm"],
                "sqi": response["sqi"],
                "rejection_reason": response["rejectionReason"],
            }
        )
    return results


def main() -> None:
    references = load_reference_annotations()
    subject_ids = sorted(references.keys())
    # Dataset protocol: only quality-1 clips carry a trustworthy ECG-referenced
    # HR. Quality-0 clips are evaluated too, but reported separately — a
    # rejection there is the SQI gate working as intended.
    eval_ids = [s for s in subject_ids if references[s]["quality"] >= MIN_QUALITY]
    low_quality_ids = [s for s in subject_ids if references[s]["quality"] < MIN_QUALITY]
    print(f"BUT PPG calibration: {len(eval_ids)} quality-1 records "
          f"(+{len(low_quality_ids)} quality-0), {WINDOW_SECONDS:.0f}s windows")

    per_subject: list[dict] = []
    all_errors: list[float] = []
    all_window_results: list[dict] = []
    low_quality_outcomes: dict[str, int] = {}

    for subject_id in subject_ids:
        meta = references[subject_id]
        if meta["quality"] < MIN_QUALITY:
            path = record_path(subject_id)
            outcome = "SKIP(no-file)"
            if path.with_suffix(".hea").exists():
                try:
                    signal, fs = load_record(path.with_suffix(".hea"))
                    outcome = evaluate_windows(signal, fs)[0]["status"]
                except Exception:  # noqa: BLE001
                    outcome = "SKIP(unreadable)"
            low_quality_outcomes[outcome] = low_quality_outcomes.get(outcome, 0) + 1
            print(f"  LOWQ {subject_id}: quality={meta['quality']}, pipeline -> {outcome}")
            continue
        path = record_path(subject_id)
        if not path.with_suffix(".hea").exists():
            print(f"  SKIP {subject_id}: data files not present")
            continue

        try:
            signal, fs = load_record(path.with_suffix(".hea"))
        except Exception as exc:  # noqa: BLE001
            print(f"  SKIP {subject_id}: unreadable record ({exc})")
            continue

        window_results = evaluate_windows(signal, fs)
        accepted = [w for w in window_results if w["status"] == "PROCESSED" and w["bpm"]]

        errors = [abs(w["bpm"] - meta["reference_hr"]) for w in accepted]
        all_errors.extend(errors)
        all_window_results.extend(
            {**w, "subject": subject_id} for w in window_results
        )

        per_subject.append(
            {
                "subject": subject_id,
                "reference_hr": meta["reference_hr"],
                "windows": len(window_results),
                "accepted_windows": len(accepted),
                "mae_bpm": round(float(np.mean(errors)), 3) if errors else None,
                "estimated_hr_median": (
                    round(float(np.median([w["bpm"] for w in accepted])), 2)
                    if accepted
                    else None
                ),
            }
        )
        status_word = "OK " if errors else "REJ"
        mae_text = f"{np.mean(errors):5.2f}" if errors else "  -- "
        est_text = (
            f"{np.median([w['bpm'] for w in accepted]):6.1f}" if accepted else "   -- "
        )
        print(f"  {status_word} {subject_id}: ref={meta['reference_hr']:5.1f} bpm, "
              f"est={est_text}, accepted {len(accepted)}/{len(window_results)}, MAE={mae_text}")

    total_windows = len(all_window_results)
    accepted_windows = sum(1 for w in all_window_results if w["status"] == "PROCESSED")
    mae = float(np.mean(all_errors)) if all_errors else float("nan")
    p90 = float(np.percentile(all_errors, 90)) if all_errors else float("nan")
    coverage = (accepted_windows / total_windows * 100) if total_windows else 0.0

    rejection_reasons: dict[str, int] = {}
    for w in all_window_results:
        if w["status"] == "REJECTED":
            reason = w["rejection_reason"] or "UNKNOWN"
            rejection_reasons[reason] = rejection_reasons.get(reason, 0) + 1

    print(
        "\n=== BUT PPG Calibration Report ==="
        f"\nRecords evaluated:         {len(per_subject)} (quality-1 subset)"
        f"\nQuality-0 clip outcomes:   {low_quality_outcomes}"
        f"\nWindows evaluated:         {total_windows}"
        f"\nAccepted windows:          {accepted_windows} ({coverage:.1f}% coverage)"
        f"\nRejections:                {rejection_reasons}"
        f"\nMAE (accepted windows):    {mae:.3f} BPM   (PRD target <= 5.0)"
        f"\nP90 error:                 {p90:.3f} BPM"
        f"\n{'RESULT: PASS' if mae <= 5.0 else 'RESULT: FAIL (MAE above 5.0 BPM)'}"
        "\n=================================="
    )

    RESULTS_JSON.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "dataset": "BUT PPG v1.0.0 (PhysioNet)",
                "window_seconds": WINDOW_SECONDS,
                "records": per_subject,
                "low_quality_clip_outcomes": low_quality_outcomes,
                "summary": {
                    "total_windows": total_windows,
                    "accepted_windows": accepted_windows,
                    "coverage_percent": round(coverage, 2),
                    "mae_bpm": round(mae, 3) if not math.isnan(mae) else None,
                    "p90_error_bpm": round(p90, 3) if not math.isnan(p90) else None,
                    "rejection_reasons": rejection_reasons,
                    "prd_target_mae_bpm": 5.0,
                    "pass": bool(mae <= 5.0),
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nDetailed results written to {RESULTS_JSON}")


if __name__ == "__main__":
    main()
