import { describe, it, expect } from 'vitest';
import {
  Gender,
  SmokerStatus,
  AgeBin,
  SbpBin,
  BmiBin,
  WhoRiskCategory,
} from '../../../src/modules/screening/types.js';
import {
  CLINICAL_CONSTANTS,
  SCREENING_ERROR_CODES,
  MANDATORY_CLINICAL_DISCLAIMER,
  CATEGORY_TO_RISK_LEVEL,
  mapCategoryToRiskLevel,
  WHO_SEAR_NON_LAB_MATRIX,
  WHO_SEAR_LAB_MATRIX,
} from '../../../src/modules/screening/constants.js';
import {
  validateScreeningEvaluationRequest,
  validateScreeningEvaluationResponse,
  ScreeningEvaluationRequestSchema,
  ScreeningEvaluationResponseSchema,
} from '../../../src/modules/screening/validators.js';
import {
  ClinicalValidationError,
  ValidationError,
} from '../../../src/shared/errors/domain-error.js';

describe('Screening Types, Constants & Validation Schemas (MOD-01 Checkpoint 5)', () => {
  describe('Constants & WHO Matrix Integrity', () => {
    it('should have mandatory clinical disclaimer matching WHO SEAR standard', () => {
      expect(MANDATORY_CLINICAL_DISCLAIMER).toBe(
        'Estimasi risiko 10 tahun berbasis populasi WHO South-East Asia Region. Hasil ini bukan diagnosis pasti dan wajib dikonsultasikan dengan dokter di fasilitas pelayanan kesehatan.'
      );
    });

    it('should correctly map all 5 WHO risk categories to 4 triage levels', () => {
      expect(mapCategoryToRiskLevel('UNDER_5_PERCENT')).toBe('LOW_RISK');
      expect(mapCategoryToRiskLevel('5_TO_UNDER_10_PERCENT')).toBe('LOW_RISK');
      expect(mapCategoryToRiskLevel('10_TO_UNDER_20_PERCENT')).toBe('MODERATE_RISK');
      expect(mapCategoryToRiskLevel('20_TO_UNDER_30_PERCENT')).toBe('HIGH_RISK');
      expect(mapCategoryToRiskLevel('30_PERCENT_AND_ABOVE')).toBe('VERY_HIGH_RISK');
    });

    it('should verify all 400 cells in WHO_SEAR_NON_LAB_MATRIX are populated', () => {
      const genders: Gender[] = ['MALE', 'FEMALE'];
      const smokerStatuses: SmokerStatus[] = ['SMOKER', 'NON_SMOKER'];
      const ageBins: AgeBin[] = [
        'BIN_AGE_40_44',
        'BIN_AGE_45_49',
        'BIN_AGE_50_54',
        'BIN_AGE_55_59',
      ];
      const sbpBins: SbpBin[] = [
        'BIN_SBP_UNDER_120',
        'BIN_SBP_120_139',
        'BIN_SBP_140_159',
        'BIN_SBP_160_179',
        'BIN_SBP_180_ABOVE',
      ];
      const bmiBins: BmiBin[] = [
        'BIN_BMI_UNDER_20',
        'BIN_BMI_20_TO_24',
        'BIN_BMI_25_TO_29',
        'BIN_BMI_30_TO_34',
        'BIN_BMI_35_ABOVE',
      ];

      let cellCount = 0;
      for (const g of genders) {
        for (const s of smokerStatuses) {
          for (const a of ageBins) {
            for (const sbp of sbpBins) {
              for (const bmi of bmiBins) {
                const category = WHO_SEAR_NON_LAB_MATRIX[g][s][a][sbp][bmi];
                expect(category).toBeDefined();
                expect(Object.keys(CATEGORY_TO_RISK_LEVEL)).toContain(category);
                cellCount++;

                // SBP >= 180 mmHg is ALWAYS 30_PERCENT_AND_ABOVE (Hypertensive Crisis safeguard)
                if (sbp === 'BIN_SBP_180_ABOVE') {
                  expect(category).toBe('30_PERCENT_AND_ABOVE');
                }
              }
            }
          }
        }
      }

      // 2 * 2 * 4 * 5 * 5 = 400 cells
      expect(cellCount).toBe(400);
    });

    it('should verify sample truth table for Male Smoker 50-54y matches Lancet 2019 values', () => {
      const block = WHO_SEAR_NON_LAB_MATRIX.MALE.SMOKER.BIN_AGE_50_54;
      expect(block.BIN_SBP_UNDER_120.BIN_BMI_UNDER_20).toBe('UNDER_5_PERCENT');
      expect(block.BIN_SBP_140_159.BIN_BMI_20_TO_24).toBe('10_TO_UNDER_20_PERCENT');
      expect(block.BIN_SBP_140_159.BIN_BMI_30_TO_34).toBe('20_TO_UNDER_30_PERCENT');
      expect(block.BIN_SBP_160_179.BIN_BMI_35_ABOVE).toBe('30_PERCENT_AND_ABOVE');
      expect(block.BIN_SBP_180_ABOVE.BIN_BMI_20_TO_24).toBe('30_PERCENT_AND_ABOVE');
    });

    it('should verify WHO_SEAR_LAB_MATRIX contains complete paths for lab evaluation', () => {
      const maleDiabeticSmoker =
        WHO_SEAR_LAB_MATRIX.MALE.SMOKER.DIABETIC.BIN_AGE_50_54.BIN_SBP_180_ABOVE;
      expect(maleDiabeticSmoker.BIN_CHOL_UNDER_4).toBe('30_PERCENT_AND_ABOVE');
      expect(maleDiabeticSmoker.BIN_CHOL_7_ABOVE).toBe('30_PERCENT_AND_ABOVE');
    });
  });

  describe('Validation & Boundary Guardrails (validateScreeningEvaluationRequest)', () => {
    const validBaseInput = {
      patientAgeYears: 50,
      gender: 'MALE' as const,
      isCurrentSmoker: true,
      systolicBloodPressureMmHg: 130,
      bodyMassIndex: 24.5,
    };

    it('TC-SCREEN-001: should accept lower bound age 40 years', () => {
      const result = validateScreeningEvaluationRequest({
        ...validBaseInput,
        patientAgeYears: 40,
      });
      expect(result.patientAgeYears).toBe(40);
    });

    it('TC-SCREEN-002: should accept upper bound age 59 years', () => {
      const result = validateScreeningEvaluationRequest({
        ...validBaseInput,
        patientAgeYears: 59,
      });
      expect(result.patientAgeYears).toBe(59);
    });

    it('TC-SCREEN-003: should reject unsupported age below 40 (<40) with HTTP 422', () => {
      expect(() => {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          patientAgeYears: 39,
        });
      }).toThrowError(ClinicalValidationError);

      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          patientAgeYears: 39,
        });
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_AGE_OUT_OF_STUDY_RANGE);
        expect(error.invalidParams?.[0]?.field).toBe('patientAgeYears');
      }
    });

    it('TC-SCREEN-004: should reject unsupported age above 59 (>=60) with HTTP 422', () => {
      expect(() => {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          patientAgeYears: 60,
        });
      }).toThrowError(ClinicalValidationError);

      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          patientAgeYears: 60,
        });
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_AGE_OUT_OF_STUDY_RANGE);
      }
    });

    it('TC-SCREEN-016: should reject request when both BMI and weight/height are missing', () => {
      expect(() => {
        validateScreeningEvaluationRequest({
          patientAgeYears: 48,
          gender: 'FEMALE',
          isCurrentSmoker: false,
          systolicBloodPressureMmHg: 120,
        });
      }).toThrowError(ClinicalValidationError);

      try {
        validateScreeningEvaluationRequest({
          patientAgeYears: 48,
          gender: 'FEMALE',
          isCurrentSmoker: false,
          systolicBloodPressureMmHg: 120,
        });
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_MISSING_ADIPOSITY_DATA);
      }
    });

    it('should accept request when BMI is null but valid weight and height are provided', () => {
      const result = validateScreeningEvaluationRequest({
        patientAgeYears: 48,
        gender: 'FEMALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 120,
        bodyMassIndex: null,
        weightKg: 65,
        heightCm: 160,
      });

      expect(result.weightKg).toBe(65);
      expect(result.heightCm).toBe(160);
    });

    it('TC-SCREEN-017: should reject physiological SBP anomaly below 70 or above 240 mmHg', () => {
      // SBP < 70
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          systolicBloodPressureMmHg: 50,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_SBP_OUT_OF_BOUNDS);
      }

      // SBP > 240
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          systolicBloodPressureMmHg: 280,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_SBP_OUT_OF_BOUNDS);
      }
    });

    it('TC-SCREEN-018: should reject physiological BMI anomaly below 12.0 or above 60.0', () => {
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          bodyMassIndex: 8.5,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_BMI_OUT_OF_BOUNDS);
      }

      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          bodyMassIndex: 75.0,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_BMI_OUT_OF_BOUNDS);
      }
    });

    it('TC-SCREEN-019: should reject schema violations (e.g. invalid gender) with HTTP 400', () => {
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          gender: 'UNKNOWN',
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ValidationError;
        expect(error.status).toBe(400);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_SCHEMA_VALIDATION_FAILED);
        expect(error.invalidParams?.[0]?.field).toBe('gender');
      }
    });

    it('should reject non-boolean smoker status with HTTP 400', () => {
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          isCurrentSmoker: 'yes',
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ValidationError;
        expect(error.status).toBe(400);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_SCHEMA_VALIDATION_FAILED);
      }
    });

    it('should reject physiological weight anomaly below 30kg or above 250kg', () => {
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          bodyMassIndex: null,
          weightKg: 20,
          heightCm: 160,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_WEIGHT_OUT_OF_BOUNDS);
      }
    });

    it('should reject physiological height anomaly below 100cm or above 230cm', () => {
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          bodyMassIndex: null,
          weightKg: 70,
          heightCm: 80,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_HEIGHT_OUT_OF_BOUNDS);
      }
    });

    it('should reject physiological cholesterol anomaly below 2.0 or above 15.0 mmol/L', () => {
      try {
        validateScreeningEvaluationRequest({
          ...validBaseInput,
          totalCholesterolMmolL: 18.5,
        });
        expect.unreachable();
      } catch (err) {
        const error = err as ClinicalValidationError;
        expect(error.status).toBe(422);
        expect(error.errorCode).toBe(
          SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_CHOLESTEROL_OUT_OF_BOUNDS
        );
      }
    });
  });

  describe('ScreeningEvaluationResponseSchema Validation', () => {
    it('should validate a complete and conforming evaluation response payload', () => {
      const mockResponse = {
        evaluationId: 'b4c2e6d8-1a3f-4e9b-8c7d-0f1e2a3b4c5d',
        patientAgeYears: 50,
        gender: 'MALE',
        isCurrentSmoker: true,
        systolicBloodPressureMmHg: 150,
        resolvedBmi: 27.2,
        riskScoreCategory: '10_TO_UNDER_20_PERCENT',
        riskLevel: 'MODERATE_RISK',
        chartTypeUsed: 'SEAR_NON_LAB',
        binBreakdown: {
          ageBin: 'BIN_AGE_50_54',
          sbpBin: 'BIN_SBP_140_159',
          bmiBin: 'BIN_BMI_25_TO_29',
          cholesterolBin: null,
        },
        isHypertensiveCrisis: false,
        calculatedAt: '2026-10-16T08:45:00.120Z',
        clinicalDisclaimer: MANDATORY_CLINICAL_DISCLAIMER,
      };

      const parsed = validateScreeningEvaluationResponse(mockResponse);
      expect(parsed.evaluationId).toBe(mockResponse.evaluationId);
      expect(parsed.riskScoreCategory).toBe('10_TO_UNDER_20_PERCENT');
      expect(parsed.clinicalDisclaimer).toBe(MANDATORY_CLINICAL_DISCLAIMER);
    });

    it('should reject response missing mandatory clinical disclaimer', () => {
      const invalidResponse = {
        evaluationId: 'b4c2e6d8-1a3f-4e9b-8c7d-0f1e2a3b4c5d',
        patientAgeYears: 50,
        gender: 'MALE',
        isCurrentSmoker: true,
        systolicBloodPressureMmHg: 150,
        resolvedBmi: 27.2,
        riskScoreCategory: '10_TO_UNDER_20_PERCENT',
        riskLevel: 'MODERATE_RISK',
        chartTypeUsed: 'SEAR_NON_LAB',
        binBreakdown: {
          ageBin: 'BIN_AGE_50_54',
          sbpBin: 'BIN_SBP_140_159',
          bmiBin: 'BIN_BMI_25_TO_29',
          cholesterolBin: null,
        },
        isHypertensiveCrisis: false,
        calculatedAt: '2026-10-16T08:45:00.120Z',
        clinicalDisclaimer: '', // Empty disclaimer violates min(10)
      };

      expect(() => {
        validateScreeningEvaluationResponse(invalidResponse);
      }).toThrow();
    });
  });
});
