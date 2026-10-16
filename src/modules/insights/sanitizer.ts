import { ClinicalValidationError } from '../../shared/errors/domain-error.js';
import type {
  AgeGroup,
  SafePatientLlmContext,
  GenerateHealthInsightRequest,
} from './types.js';

/**
 * Maps chronological age in years to 5-year de-identified demographic bracket
 */
export function mapAgeToAgeGroup(ageYears: number): AgeGroup {
  if (ageYears >= 40 && ageYears <= 44) {
    return '40_TO_44';
  }
  if (ageYears >= 45 && ageYears <= 49) {
    return '45_TO_49';
  }
  if (ageYears >= 50 && ageYears <= 54) {
    return '50_TO_54';
  }
  if (ageYears >= 55 && ageYears <= 59) {
    return '55_TO_59';
  }

  throw new ClinicalValidationError({
    instance: '/api/v1/insights/health',
    errorCode: 'ERR_AGE_OUT_OF_STUDY_RANGE',
    detail: `Usia ${ageYears} tahun di luar rentang populasi target model (40-59 tahun).`,
  });
}

/**
 * Sanitizes input request and guarantees 0% PII leakage to LLM providers.
 * Strictly strips direct identifiers (name, NIK, phone, email, address, DOB)
 * and normalizes age to 5-year general bracket.
 */
export function sanitizeContextForLlm(
  request: GenerateHealthInsightRequest
): SafePatientLlmContext {
  const ageGroup = mapAgeToAgeGroup(request.patientAgeYears);

  const rawGaps = request.identifiedGapsSummary ?? [];
  const identifiedGapsSummary = Array.isArray(rawGaps)
    ? rawGaps.map((g) => String(g).trim()).filter((g) => g.length > 0)
    : [];

  const safeContext: SafePatientLlmContext = {
    ageGroup,
    gender: request.gender,
    systolicBloodPressureMmHg: request.systolicBloodPressureMmHg,
    resolvedBmi: Math.round(request.resolvedBmi * 100) / 100,
    isCurrentSmoker: Boolean(request.isCurrentSmoker),
    riskCategory: request.riskCategory,
    riskLevel: request.riskLevel,
    isHypertensiveCrisis: Boolean(request.isHypertensiveCrisis),
    hasActiveGaps: identifiedGapsSummary.length > 0,
    identifiedGapsSummary,
    preferredLanguage: request.preferredLanguage ?? 'id_ID',
  };

  return safeContext;
}
