import { z } from 'zod';
import { ValidationError } from '../../shared/errors/domain-error.js';
import type {
  RehabSessionEvaluationRequest,
} from './types.js';

export const RehabRepEventSchema = z.object({
  repNumber: z.number().int().nonnegative(),
  startTimestampMs: z.number().nonnegative(),
  endTimestampMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  peakAngleDegrees: z.number().min(0).max(250),
  accepted: z.boolean(),
  rejectionReason: z.enum(['TOO_JERKY']).optional(),
});

export const RehabEngineResultSchema = z.object({
  exerciseType: z.enum(['SHOULDER_ABDUCTION', 'ELBOW_FLEXION']),
  totalFrameCount: z.number().int().positive(),
  validRepCount: z.number().int().nonnegative(),
  partialRepCount: z.number().int().nonnegative(),
  rejectedRepCount: z.number().int().nonnegative(),
  reps: z.array(RehabRepEventSchema).max(500),
  shoulderHikeAlerts: z
    .array(
      z.object({
        frameIndex: z.number().int().nonnegative(),
        timestampMs: z.number().nonnegative(),
        liftRatioPercent: z.number(),
      })
    )
    .max(500),
  minObservedAngleDegrees: z.number().min(0).max(250),
  maxObservedAngleDegrees: z.number().min(0).max(250),
});

export const RehabSessionEvaluationRequestSchema = z
  .object({
    patientId: z.string().trim().min(1),
    exerciseType: z.enum(['SHOULDER_ABDUCTION', 'ELBOW_FLEXION']),
    prescribedRepTarget: z.number().int().min(1).max(100),
    engineResult: RehabEngineResultSchema,
  })
  .strict();

/**
 * Validates the session evaluation request; failures become RFC 7807 errors
 */
export function validateRehabSessionRequest(
  rawInput: unknown,
  instance: string
): RehabSessionEvaluationRequest {
  const result = RehabSessionEvaluationRequestSchema.safeParse(rawInput);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      instance,
      errorCode: 'ERR_REHAB_REQUEST_VALIDATION_FAILED',
    });
  }
  return result.data as RehabSessionEvaluationRequest;
}

export const REHAB_MANDATORY_DISCLAIMER =
  'Evaluasi sesi latihan ini dihasilkan otomatis berbasis analisis gerak kamera dan BUKAN pengganti supervisi atau evaluasi langsung oleh fisioterapis.';
