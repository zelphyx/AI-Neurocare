import crypto from 'node:crypto';
import {
  validateRehabSessionRequest,
  REHAB_MANDATORY_DISCLAIMER,
} from './validators.js';
import type {
  RehabSessionEvaluationRequest,
  RehabSessionEvaluationResponse,
} from './types.js';

export interface EvaluateRehabSessionOptions {
  instance?: string | undefined;
  sessionId?: string | undefined;
}

const REHAB_INSTANCE = '/api/v1/rehab/session/evaluate';

/**
 * Backend Session Evaluator (MOD-05 Checkpoint 23).
 *
 * Consumes the deterministic on-device rehab engine output (rep counts, ROM
 * range, compensation alerts) and produces the clinically-framed session
 * evaluation: achievement %, form quality, and prescription status.
 * 100% deterministic — no LLM involvement.
 */
export function evaluateRehabSession(
  rawInput: unknown,
  options?: EvaluateRehabSessionOptions
): RehabSessionEvaluationResponse {
  const instance = options?.instance ?? REHAB_INSTANCE;
  const request: RehabSessionEvaluationRequest = validateRehabSessionRequest(
    rawInput,
    instance
  );

  const { engineResult, prescribedRepTarget } = request;

  const acceptedReps = engineResult.reps.filter((rep) => rep.accepted);
  const achievementPercent =
    Math.min(
      100,
      Math.round((engineResult.validRepCount / prescribedRepTarget) * 1000) / 10
    );

  const avgPeakAngleDegrees =
    acceptedReps.length > 0
      ? Math.round(
          (acceptedReps.reduce((sum, rep) => sum + rep.peakAngleDegrees, 0) /
            acceptedReps.length) *
            100
        ) / 100
      : 0;

  // Form quality: compensation alerts and jerked reps degrade confidence
  const shoulderHikeAlertCount = engineResult.shoulderHikeAlerts.length;
  const formQuality =
    shoulderHikeAlertCount === 0 && engineResult.rejectedRepCount === 0
      ? 'GOOD'
      : shoulderHikeAlertCount <= 3 && engineResult.rejectedRepCount <= 2
        ? 'ACCEPTABLE'
        : 'NEEDS_SUPERVISION';

  const exercisePrescriptionStatus =
    engineResult.validRepCount >= prescribedRepTarget
      ? 'TARGET_MET'
      : engineResult.validRepCount > 0
        ? 'TARGET_PARTIALLY_MET'
        : 'TARGET_NOT_MET';

  return {
    sessionId: options?.sessionId ?? `reh-${crypto.randomUUID()}`,
    patientId: request.patientId,
    exerciseType: request.exerciseType,
    evaluatedAt: new Date().toISOString(),
    validRepCount: engineResult.validRepCount,
    prescribedRepTarget,
    achievementPercent,
    partialRepCount: engineResult.partialRepCount,
    rejectedRepCount: engineResult.rejectedRepCount,
    avgPeakAngleDegrees,
    minObservedAngleDegrees: engineResult.minObservedAngleDegrees,
    maxObservedAngleDegrees: engineResult.maxObservedAngleDegrees,
    shoulderHikeAlertCount,
    formQuality,
    exercisePrescriptionStatus,
    clinicalDisclaimer: REHAB_MANDATORY_DISCLAIMER,
  };
}
