import { z } from 'zod';
import { ValidationError } from '../../shared/errors/domain-error.js';
import type {
  RehabSessionRecord,
  RecoveryEvaluationRequest,
  RecoveryNarrativeContent,
} from './types.js';

export const MANDATORY_RECOVERY_DISCLAIMER =
  'Laporan pemulihan ini merupakan evaluasi otomatis berbasis data latihan Anda dan BUKAN diagnosis atau pengganti konsultasi dengan dokter atau fisioterapis.';

export const RECOVERY_CONSTANTS = {
  MIN_OBSERVATION_DAYS: 3,
  MIN_COMPLETED_SESSIONS: 2,
  MAX_ROM_DEGREES: 250,
  MAX_RESTING_BPM: 200,
  MIN_RESTING_BPM: 30,
  MAX_DURATION_MINUTES: 300,
  /** Delta ROM beyond this is treated as stable band (noise margin) */
  ROM_STABLE_BAND_DEGREES: 5,
  /** Resting BPM delta beyond this is treated as stable band */
  BPM_STABLE_BAND: 5,
} as const;

const IsoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Waktu harus berupa string tanggal ISO 8601 yang valid.',
  });

export const RehabSessionRecordSchema = z.object({
  sessionId: z.string().trim().min(1),
  performedAt: IsoDateTimeSchema,
  romDegrees: z.number().min(0).max(RECOVERY_CONSTANTS.MAX_ROM_DEGREES).nullable().optional(),
  restingHeartRateBpm: z
    .number()
    .min(RECOVERY_CONSTANTS.MIN_RESTING_BPM)
    .max(RECOVERY_CONSTANTS.MAX_RESTING_BPM)
    .nullable()
    .optional(),
  durationMinutes: z.number().min(1).max(RECOVERY_CONSTANTS.MAX_DURATION_MINUTES),
  completionStatus: z.enum(['COMPLETED', 'PARTIAL', 'SKIPPED']),
  reportedSymptoms: z.array(z.string().trim().min(1)).optional(),
});

export const RecoveryEvaluationRequestSchema = z
  .object({
    patientId: z.string().trim().min(1),
    evaluationDate: IsoDateTimeSchema.optional(),
    prescribedSessionsPerWeek: z.number().int().min(1).max(21),
    currentWeekSessions: z.array(RehabSessionRecordSchema).max(50),
    previousWeekSessions: z.array(RehabSessionRecordSchema).max(50).optional(),
  })
  .strict();

/**
 * Validates the recovery evaluation request; failures become RFC 7807 ValidationError
 */
export function validateRecoveryEvaluationRequest(
  rawInput: unknown,
  instance: string
): RecoveryEvaluationRequest {
  const result = RecoveryEvaluationRequestSchema.safeParse(rawInput);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      instance,
      errorCode: 'ERR_RECOVERY_REQUEST_VALIDATION_FAILED',
    });
  }
  return result.data as RecoveryEvaluationRequest;
}

export const RecoveryNarrativeContentSchema = z.object({
  headline: z.string().trim().min(5).max(200),
  summaryNarration: z.string().trim().min(20).max(2500),
  positiveProgressNotes: z.array(z.string().trim().min(3)).min(1).max(5),
  cautionNotes: z.array(z.string().trim().min(3)).min(1).max(5),
  nextWeekGuidance: z.array(z.string().trim().min(3)).min(1).max(5),
  mandatoryDisclaimer: z.string().trim().min(10).max(600),
});

// Recovery-specific guardrail patterns
const CURE_CLAIM_PATTERNS = [
  /\b(?:telah\s+|sudah\s+)?sembuh(?:\s+total|\s+sepenuhnya)?\b/i,
  /\bmenyembuhkan\b/i,
  /\bpulih\s+sepenuhnya\b/i,
  /\bterapi\s+penyembuhan\b/i,
];

const PROHIBITED_DRUG_PATTERNS = [
  /\b(?:amlodipin|captopril|lisinopril|ramipril|losartan|valsartan|bisoprolol|atenolol|metoprolol|furosemide|spironolactone)\b/i,
  /\b(?:metformin|glibenclamid|glimepirid|insulin|simvastatin|atorvastatin|aspilet|aspirin|clopidogrel|warfarin)\b/i,
  /\b\d+\s*(?:mg|miligram|mcg|tablet|kapsul)\b/i,
];

/**
 * Validates LLM-generated recovery narrative: schema + zero cure claims +
 * zero drug prescriptions. Returns violation codes (empty = valid).
 */
export function validateRecoveryNarrativeGuardrails(
  narrative: RecoveryNarrativeContent
): string[] {
  const violations: string[] = [];

  const allText = [
    narrative.headline,
    narrative.summaryNarration,
    ...narrative.positiveProgressNotes,
    ...narrative.cautionNotes,
    ...narrative.nextWeekGuidance,
  ].join(' ');

  for (const pattern of CURE_CLAIM_PATTERNS) {
    if (pattern.test(allText)) {
      violations.push('RECOVERY_GUARDRAIL_CURE_CLAIM');
      break;
    }
  }

  for (const pattern of PROHIBITED_DRUG_PATTERNS) {
    if (pattern.test(allText)) {
      violations.push('RECOVERY_GUARDRAIL_DRUG_PRESCRIPTION');
      break;
    }
  }

  const lowerDisclaimer = narrative.mandatoryDisclaimer.toLowerCase();
  if (!lowerDisclaimer.includes('bukan diagnosis')) {
    violations.push('RECOVERY_GUARDRAIL_INVALID_DISCLAIMER');
  }

  return violations;
}

/**
 * Validates LLM narrative against Zod schema; throws RFC 7807 ValidationError
 */
export function parseRecoveryNarrative(
  raw: unknown
): RecoveryNarrativeContent {
  const result = RecoveryNarrativeContentSchema.safeParse(raw);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      instance: '/api/v1/recovery/insight',
      errorCode: 'ERR_RECOVERY_NARRATIVE_SCHEMA_VIOLATION',
    });
  }
  return result.data;
}

export type { RehabSessionRecord };
