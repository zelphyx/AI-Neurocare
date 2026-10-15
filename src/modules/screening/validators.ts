import { z } from 'zod';
import {
  ClinicalValidationError,
  ValidationError,
} from '../../shared/errors/domain-error.js';
import {
  CLINICAL_CONSTANTS,
  SCREENING_ERROR_CODES,
} from './constants.js';
import type {
  ScreeningEvaluationRequest,
  ScreeningEvaluationResponse,
} from './types.js';

export const GenderSchema = z.enum(['MALE', 'FEMALE'], {
  errorMap: () => ({ message: "Jenis kelamin harus bernilai 'MALE' atau 'FEMALE'." }),
});

export const WhoRiskCategorySchema = z.enum([
  'UNDER_5_PERCENT',
  '5_TO_UNDER_10_PERCENT',
  '10_TO_UNDER_20_PERCENT',
  '20_TO_UNDER_30_PERCENT',
  '30_PERCENT_AND_ABOVE',
]);

export const WhoRiskLevelSchema = z.enum([
  'LOW_RISK',
  'MODERATE_RISK',
  'HIGH_RISK',
  'VERY_HIGH_RISK',
]);

export const WhoChartTypeSchema = z.enum(['SEAR_NON_LAB', 'SEAR_LAB']);

export const BinBreakdownSchema = z.object({
  ageBin: z.enum(['BIN_AGE_40_44', 'BIN_AGE_45_49', 'BIN_AGE_50_54', 'BIN_AGE_55_59']),
  sbpBin: z.enum([
    'BIN_SBP_UNDER_120',
    'BIN_SBP_120_139',
    'BIN_SBP_140_159',
    'BIN_SBP_160_179',
    'BIN_SBP_180_ABOVE',
  ]),
  bmiBin: z
    .enum([
      'BIN_BMI_UNDER_20',
      'BIN_BMI_20_TO_24',
      'BIN_BMI_25_TO_29',
      'BIN_BMI_30_TO_34',
      'BIN_BMI_35_ABOVE',
    ])
    .nullable(),
  cholesterolBin: z
    .enum([
      'BIN_CHOL_UNDER_4',
      'BIN_CHOL_4_TO_4_9',
      'BIN_CHOL_5_TO_5_9',
      'BIN_CHOL_6_TO_6_9',
      'BIN_CHOL_7_ABOVE',
    ])
    .nullable(),
});

/**
 * Raw Schema to validate HTTP types & JSON structure (Level 1 Schema Validation)
 */
export const ScreeningEvaluationRequestSchema = z
  .object({
    patientAgeYears: z.number().int({ message: 'Usia pasien harus berupa bilangan bulat.' }),
    gender: GenderSchema,
    isCurrentSmoker: z.boolean({ message: 'Status merokok harus berupa boolean (true/false).' }),
    systolicBloodPressureMmHg: z
      .number()
      .int({ message: 'Tekanan darah sistolik harus berupa bilangan bulat (mmHg).' }),
    bodyMassIndex: z.number().nullable().optional(),
    weightKg: z.number().nullable().optional(),
    heightCm: z.number().nullable().optional(),
    totalCholesterolMmolL: z.number().nullable().optional(),
    hasDiabetes: z.boolean().nullable().optional(),
  })
  .strict();

/**
 * Response Schema adhering strictly to PRD 02 specification
 */
export const ScreeningEvaluationResponseSchema = z.object({
  evaluationId: z.string().uuid({ message: 'EvaluationId harus berupa UUID v4 valid.' }),
  patientAgeYears: z.number().int(),
  gender: GenderSchema,
  isCurrentSmoker: z.boolean(),
  systolicBloodPressureMmHg: z.number().int(),
  resolvedBmi: z.number(),
  riskScoreCategory: WhoRiskCategorySchema,
  riskLevel: WhoRiskLevelSchema,
  chartTypeUsed: WhoChartTypeSchema,
  binBreakdown: BinBreakdownSchema,
  isHypertensiveCrisis: z.boolean(),
  calculatedAt: z.string().datetime({ message: 'CalculatedAt harus berformat ISO 8601 UTC.' }),
  clinicalDisclaimer: z.string().min(10),
});

/**
 * Validates screening evaluation input against both JSON schema constraints
 * and domain physiological/clinical guardrails.
 * Throws RFC 7807 DomainErrors (ClinicalValidationError or ValidationError).
 */
export function validateScreeningEvaluationRequest(
  input: unknown,
  instance: string = '/api/v1/screening/evaluate'
): ScreeningEvaluationRequest {
  // Step 1: Validate generic JSON schema & type structure
  const parseResult = ScreeningEvaluationRequestSchema.safeParse(input);
  if (!parseResult.success) {
    throw ValidationError.fromZodError(parseResult.error, {
      instance,
      errorCode: SCREENING_ERROR_CODES.ERR_SCHEMA_VALIDATION_FAILED,
      status: 400,
    });
  }

  const data = parseResult.data;

  // Step 2: Validate Target Study Age Range (40-59 years)
  if (
    data.patientAgeYears < CLINICAL_CONSTANTS.MIN_SUPPORTED_AGE ||
    data.patientAgeYears > CLINICAL_CONSTANTS.MAX_SUPPORTED_AGE
  ) {
    throw new ClinicalValidationError({
      instance,
      errorCode: SCREENING_ERROR_CODES.ERR_AGE_OUT_OF_STUDY_RANGE,
      detail: `Usia pasien (${data.patientAgeYears} tahun) di luar rentang populasi target model WHO SEAR (${CLINICAL_CONSTANTS.MIN_SUPPORTED_AGE}-${CLINICAL_CONSTANTS.MAX_SUPPORTED_AGE} tahun).`,
      invalidParams: [
        {
          field: 'patientAgeYears',
          rejectedValue: data.patientAgeYears,
          reason: `Model kalkulasi risiko WHO SEAR 10 tahun hanya tervalidasi untuk rentang usia ${CLINICAL_CONSTANTS.MIN_SUPPORTED_AGE} hingga ${CLINICAL_CONSTANTS.MAX_SUPPORTED_AGE} tahun.`,
        },
      ],
    });
  }

  // Step 3: Validate SBP Physiological Bounds (70 - 240 mmHg)
  if (
    data.systolicBloodPressureMmHg < CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_SBP ||
    data.systolicBloodPressureMmHg > CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_SBP
  ) {
    throw new ClinicalValidationError({
      instance,
      errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_SBP_OUT_OF_BOUNDS,
      detail: `Nilai tekanan darah sistolik (${data.systolicBloodPressureMmHg} mmHg) berada di luar batas fisiologis yang dapat diproses (${CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_SBP}-${CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_SBP} mmHg).`,
      invalidParams: [
        {
          field: 'systolicBloodPressureMmHg',
          rejectedValue: data.systolicBloodPressureMmHg,
          reason: `Nilai tekanan darah sistolik harus berada dalam rentang fisiologis ${CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_SBP} hingga ${CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_SBP} mmHg.`,
        },
      ],
    });
  }

  // Step 4: Validate Adiposity Input (BMI or Weight + Height)
  const hasDirectBmi = data.bodyMassIndex !== null && data.bodyMassIndex !== undefined;
  const hasWeight = data.weightKg !== null && data.weightKg !== undefined;
  const hasHeight = data.heightCm !== null && data.heightCm !== undefined;

  if (!hasDirectBmi && (!hasWeight || !hasHeight)) {
    throw new ClinicalValidationError({
      instance,
      errorCode: SCREENING_ERROR_CODES.ERR_MISSING_ADIPOSITY_DATA,
      detail:
        'Data adipositas tidak lengkap. Wajib menyertakan parameter bodyMassIndex ATAU kombinasi weightKg dan heightCm.',
      invalidParams: [
        {
          field: 'bodyMassIndex',
          rejectedValue: null,
          reason:
            'Kalkulasi model Non-Lab memerlukan nilai BMI atau kombinasi berat badan (weightKg) dan tinggi badan (heightCm).',
        },
      ],
    });
  }

  // Step 5: Validate Physiological Range for Direct BMI
  if (hasDirectBmi) {
    const bmi = data.bodyMassIndex!;
    if (
      bmi < CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_BMI ||
      bmi > CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_BMI
    ) {
      throw new ClinicalValidationError({
        instance,
        errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_BMI_OUT_OF_BOUNDS,
        detail: `Nilai indeks massa tubuh (${bmi} kg/m²) berada di luar batas biologis yang masuk akal (${CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_BMI}-${CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_BMI} kg/m²).`,
        invalidParams: [
          {
            field: 'bodyMassIndex',
            rejectedValue: bmi,
            reason: `Nilai BMI harus berada dalam rentang fisiologis ${CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_BMI} hingga ${CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_BMI} kg/m².`,
          },
        ],
      });
    }
  }

  // Step 6: Validate Weight Bounds if provided
  if (hasWeight) {
    const weight = data.weightKg!;
    if (
      weight < CLINICAL_CONSTANTS.MIN_WEIGHT_KG ||
      weight > CLINICAL_CONSTANTS.MAX_WEIGHT_KG
    ) {
      throw new ClinicalValidationError({
        instance,
        errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_WEIGHT_OUT_OF_BOUNDS,
        detail: `Nilai berat badan (${weight} kg) berada di luar batas fisiologis (${CLINICAL_CONSTANTS.MIN_WEIGHT_KG}-${CLINICAL_CONSTANTS.MAX_WEIGHT_KG} kg).`,
        invalidParams: [
          {
            field: 'weightKg',
            rejectedValue: weight,
            reason: `Berat badan harus berada dalam rentang ${CLINICAL_CONSTANTS.MIN_WEIGHT_KG} hingga ${CLINICAL_CONSTANTS.MAX_WEIGHT_KG} kg.`,
          },
        ],
      });
    }
  }

  // Step 7: Validate Height Bounds if provided
  if (hasHeight) {
    const height = data.heightCm!;
    if (
      height < CLINICAL_CONSTANTS.MIN_HEIGHT_CM ||
      height > CLINICAL_CONSTANTS.MAX_HEIGHT_CM
    ) {
      throw new ClinicalValidationError({
        instance,
        errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_HEIGHT_OUT_OF_BOUNDS,
        detail: `Nilai tinggi badan (${height} cm) berada di luar batas fisiologis (${CLINICAL_CONSTANTS.MIN_HEIGHT_CM}-${CLINICAL_CONSTANTS.MAX_HEIGHT_CM} cm).`,
        invalidParams: [
          {
            field: 'heightCm',
            rejectedValue: height,
            reason: `Tinggi badan harus berada dalam rentang ${CLINICAL_CONSTANTS.MIN_HEIGHT_CM} hingga ${CLINICAL_CONSTANTS.MAX_HEIGHT_CM} cm.`,
          },
        ],
      });
    }
  }

  // Step 8: Validate Cholesterol Bounds if provided
  if (data.totalCholesterolMmolL !== null && data.totalCholesterolMmolL !== undefined) {
    const chol = data.totalCholesterolMmolL;
    if (
      chol < CLINICAL_CONSTANTS.MIN_CHOLESTEROL_MMOL ||
      chol > CLINICAL_CONSTANTS.MAX_CHOLESTEROL_MMOL
    ) {
      throw new ClinicalValidationError({
        instance,
        errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_CHOLESTEROL_OUT_OF_BOUNDS,
        detail: `Nilai kolesterol serum total (${chol} mmol/L) berada di luar rentang klinis (${CLINICAL_CONSTANTS.MIN_CHOLESTEROL_MMOL}-${CLINICAL_CONSTANTS.MAX_CHOLESTEROL_MMOL} mmol/L).`,
        invalidParams: [
          {
            field: 'totalCholesterolMmolL',
            rejectedValue: chol,
            reason: `Kadar kolesterol harus berada dalam rentang ${CLINICAL_CONSTANTS.MIN_CHOLESTEROL_MMOL} hingga ${CLINICAL_CONSTANTS.MAX_CHOLESTEROL_MMOL} mmol/L.`,
          },
        ],
      });
    }
  }

  return data;
}

/**
 * Helper to validate outgoing response before sending
 */
export function validateScreeningEvaluationResponse(
  response: unknown
): ScreeningEvaluationResponse {
  return ScreeningEvaluationResponseSchema.parse(response);
}
