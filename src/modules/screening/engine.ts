import crypto from 'node:crypto';
import {
  MANDATORY_CLINICAL_DISCLAIMER,
  CLINICAL_CONSTANTS,
  WHO_SEAR_NON_LAB_MATRIX,
  WHO_SEAR_LAB_MATRIX,
  mapCategoryToRiskLevel,
} from './constants.js';
import {
  mapAgeToBin,
  mapSbpToBin,
  mapBmiToBin,
  mapCholesterolToBin,
  resolveBmi,
} from './binning.js';
import {
  validateScreeningEvaluationRequest,
  validateScreeningEvaluationResponse,
} from './validators.js';
import type {
  ScreeningEvaluationResponse,
  WhoRiskCategory,
  WhoChartType,
  SmokerStatus,
  DiabetesStatus,
  CholesterolBin,
  BmiBin,
} from './types.js';

export interface EvaluateScreeningOptions {
  instance?: string;
  evaluationId?: string;
  calculatedAt?: string;
}

/**
 * 100% Deterministic Clinical Screening Engine (MOD-01)
 * Evaluates 10-year cardiovascular disease risk according to WHO SEAR Guidelines.
 * Strict zero-stochasticity, zero-LLM in-memory computation.
 */
export function evaluateClinicalScreening(
  rawInput: unknown,
  options?: EvaluateScreeningOptions
): ScreeningEvaluationResponse {
  const instance = options?.instance ?? '/api/v1/screening/evaluate';

  // Step 1: Syntactic & semantic physiological input validation
  const data = validateScreeningEvaluationRequest(rawInput, instance);

  // Step 2: Deterministic BMI resolution (using direct BMI or auto-calculating BB/TB^2)
  const resolvedBmi = resolveBmi(
    {
      bodyMassIndex: data.bodyMassIndex,
      weightKg: data.weightKg,
      heightCm: data.heightCm,
    },
    instance
  );

  // Step 3: Discrete parameter binning
  const ageBin = mapAgeToBin(data.patientAgeYears);
  const sbpBin = mapSbpToBin(data.systolicBloodPressureMmHg);
  const bmiBin: BmiBin = mapBmiToBin(resolvedBmi);
  const smokerStatus: SmokerStatus = data.isCurrentSmoker ? 'SMOKER' : 'NON_SMOKER';

  // Step 4: Hypertensive crisis check (SBP >= 180 mmHg)
  const isHypertensiveCrisis =
    data.systolicBloodPressureMmHg >= CLINICAL_CONSTANTS.HYPERTENSIVE_CRISIS_SBP;

  // Step 5: Deterministic Matrix Lookup (Lab vs Non-Lab)
  let riskScoreCategory: WhoRiskCategory;
  let chartTypeUsed: WhoChartType;
  let cholesterolBin: CholesterolBin | null = null;

  if (data.totalCholesterolMmolL !== null && data.totalCholesterolMmolL !== undefined) {
    chartTypeUsed = 'SEAR_LAB';
    cholesterolBin = mapCholesterolToBin(data.totalCholesterolMmolL);
    const diabetesStatus: DiabetesStatus =
      data.hasDiabetes === true ? 'DIABETIC' : 'NON_DIABETIC';

    riskScoreCategory =
      WHO_SEAR_LAB_MATRIX[data.gender][smokerStatus][diabetesStatus][ageBin][sbpBin][
        cholesterolBin
      ];
  } else {
    chartTypeUsed = 'SEAR_NON_LAB';
    riskScoreCategory =
      WHO_SEAR_NON_LAB_MATRIX[data.gender][smokerStatus][ageBin][sbpBin][bmiBin];
  }

  // Step 6: Enforce hypertensive crisis safeguard (Overrides risk to >= 30%)
  if (isHypertensiveCrisis) {
    riskScoreCategory = '30_PERCENT_AND_ABOVE';
  }

  // Step 7: Map risk category to clinical triage level
  const riskLevel = mapCategoryToRiskLevel(riskScoreCategory);

  // Step 8: Assemble final response object
  const responsePayload: ScreeningEvaluationResponse = {
    evaluationId: options?.evaluationId ?? crypto.randomUUID(),
    patientAgeYears: data.patientAgeYears,
    gender: data.gender,
    isCurrentSmoker: data.isCurrentSmoker,
    systolicBloodPressureMmHg: data.systolicBloodPressureMmHg,
    resolvedBmi,
    riskScoreCategory,
    riskLevel,
    chartTypeUsed,
    binBreakdown: {
      ageBin,
      sbpBin,
      bmiBin: chartTypeUsed === 'SEAR_NON_LAB' ? bmiBin : null,
      cholesterolBin: chartTypeUsed === 'SEAR_LAB' ? cholesterolBin : null,
    },
    isHypertensiveCrisis,
    calculatedAt: options?.calculatedAt ?? new Date().toISOString(),
    clinicalDisclaimer: MANDATORY_CLINICAL_DISCLAIMER,
  };

  // Step 9: Final validation against RFC output schema before dispatching
  return validateScreeningEvaluationResponse(responsePayload);
}
