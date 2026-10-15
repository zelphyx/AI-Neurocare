import { z } from 'zod';
import { ValidationError } from '../../shared/errors/domain-error.js';
import type {
  ScreeningGapRequest,
  ScreeningGapResponse,
} from './types.js';

export const ScreeningParameterCodeSchema = z.enum([
  'SYSTOLIC_BLOOD_PRESSURE',
  'BODY_MASS_INDEX',
  'WAIST_CIRCUMFERENCE',
  'FASTING_BLOOD_GLUCOSE',
  'SMOKING_STATUS_ASSESSMENT',
  'TOTAL_CHOLESTEROL',
]);

export const GapTypeSchema = z.enum([
  'MISSING_DATA',
  'INVALID_DATA',
  'STALE_DATA',
  'NEVER_PERFORMED',
]);

export const GapSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const HighestSeveritySchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const OverallComplianceStatusSchema = z.enum([
  'FULLY_COMPLIANT',
  'PARTIALLY_COMPLIANT',
  'NON_COMPLIANT',
  'ACTION_REQUIRED_CRITICAL',
]);

export const ScreeningRecordItemSchema = z
  .object({
    parameterCode: ScreeningParameterCodeSchema,
    recordedValue: z.union([z.number(), z.string()]).nullable().optional(),
    unit: z.string().nullable().optional(),
    recordedAt: z
      .string()
      .datetime({ message: 'recordedAt harus berformat ISO 8601 UTC string.' })
      .nullable()
      .optional(),
  })
  .strict();

export const KnownRiskProfileSchema = z
  .object({
    isKnownHypertensive: z.boolean().optional(),
    isKnownDiabetic: z.boolean().optional(),
  })
  .strict();

export const ScreeningGapRequestSchema = z
  .object({
    patientId: z.string().uuid({ message: 'patientId harus berupa UUID valid.' }),
    evaluationDate: z
      .string()
      .datetime({ message: 'evaluationDate harus berupa string ISO 8601 valid.' })
      .optional(),
    knownRiskProfile: KnownRiskProfileSchema.optional(),
    screeningRecords: z.array(ScreeningRecordItemSchema).min(0).max(20),
  })
  .strict();

export const ActionableRecommendationSchema = z
  .object({
    actionCode: z.string().min(1),
    targetFacility: z.string().min(1),
    userGuidanceText: z.string().min(1),
  })
  .strict();

export const ScreeningGapItemSchema = z
  .object({
    parameterCode: ScreeningParameterCodeSchema,
    parameterName: z.string().min(1),
    pillarName: z.string().min(1),
    gapType: GapTypeSchema,
    severity: GapSeveritySchema,
    daysSinceLastRecorded: z.number().int().nullable(),
    validityWindowDays: z.number().int().positive(),
    recordedValue: z.union([z.number(), z.string()]).nullable(),
    actionableRecommendation: ActionableRecommendationSchema,
  })
  .strict();

export const ScreeningGapResponseSchema = z
  .object({
    reportId: z.string().uuid(),
    patientId: z.string().uuid(),
    evaluationDate: z.string().datetime(),
    overallComplianceStatus: OverallComplianceStatusSchema,
    totalParametersEvaluated: z.number().int().min(1),
    activeGapsCount: z.number().int().min(0),
    highestSeverity: HighestSeveritySchema,
    identifiedGaps: z.array(ScreeningGapItemSchema),
    clinicalDisclaimer: z.string().min(10),
  })
  .strict();

/**
 * Validates incoming gap detection HTTP request against JSON Schema & RFC 7807 rules
 */
export function validateScreeningGapRequest(
  input: unknown,
  instance: string = '/api/v1/screening/gaps'
): ScreeningGapRequest {
  const result = ScreeningGapRequestSchema.safeParse(input);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      instance,
      errorCode: 'ERR_GAP_REQUEST_VALIDATION_FAILED',
      status: 400,
    });
  }
  return result.data;
}

/**
 * Validates outgoing gap detection response against schema
 */
export function validateScreeningGapResponse(response: unknown): ScreeningGapResponse {
  return ScreeningGapResponseSchema.parse(response);
}
