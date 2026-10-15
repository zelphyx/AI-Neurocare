import { describe, it, expect } from 'vitest';
import { evaluateClinicalScreening } from '../../../src/modules/screening/engine.js';
import { MANDATORY_CLINICAL_DISCLAIMER } from '../../../src/modules/screening/constants.js';
import {
  ClinicalValidationError,
  ValidationError,
} from '../../../src/shared/errors/domain-error.js';

describe('Clinical Screening Engine Core & PRD 02 Test Cases (MOD-01 Checkpoint 6)', () => {
  it('TC-SCREEN-001: should correctly evaluate lower bound age (40 years)', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 40,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 110,
      bodyMassIndex: 22.0,
    });

    expect(response.patientAgeYears).toBe(40);
    expect(response.binBreakdown.ageBin).toBe('BIN_AGE_40_44');
    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_UNDER_120');
    expect(response.binBreakdown.bmiBin).toBe('BIN_BMI_20_TO_24');
    expect(response.riskScoreCategory).toBe('UNDER_5_PERCENT');
    expect(response.riskLevel).toBe('LOW_RISK');
    expect(response.isHypertensiveCrisis).toBe(false);
  });

  it('TC-SCREEN-002: should correctly evaluate upper bound age (59 years)', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 59,
      gender: 'FEMALE',
      isCurrentSmoker: true,
      systolicBloodPressureMmHg: 130,
      bodyMassIndex: 24.5,
    });

    expect(response.patientAgeYears).toBe(59);
    expect(response.binBreakdown.ageBin).toBe('BIN_AGE_55_59');
    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_120_139');
    expect(response.riskLevel).toBeDefined();
    expect(response.isHypertensiveCrisis).toBe(false);
  });

  it('TC-SCREEN-003: should reject unsupported age below 40 (<40) with HTTP 422', () => {
    expect(() => {
      evaluateClinicalScreening({
        patientAgeYears: 39,
        gender: 'MALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 120,
        bodyMassIndex: 23.0,
      });
    }).toThrowError(ClinicalValidationError);

    try {
      evaluateClinicalScreening({
        patientAgeYears: 39,
        gender: 'MALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 120,
        bodyMassIndex: 23.0,
      });
    } catch (err) {
      const error = err as ClinicalValidationError;
      expect(error.status).toBe(422);
      expect(error.errorCode).toBe('ERR_AGE_OUT_OF_STUDY_RANGE');
    }
  });

  it('TC-SCREEN-004: should reject unsupported age above 59 (>=60) with HTTP 422', () => {
    try {
      evaluateClinicalScreening({
        patientAgeYears: 60,
        gender: 'FEMALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 120,
        bodyMassIndex: 23.0,
      });
      expect.unreachable();
    } catch (err) {
      const error = err as ClinicalValidationError;
      expect(error.status).toBe(422);
      expect(error.errorCode).toBe('ERR_AGE_OUT_OF_STUDY_RANGE');
    }
  });

  it('TC-SCREEN-005: should map SBP 119 to BIN_SBP_UNDER_120', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 119,
      bodyMassIndex: 22.0,
    });

    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_UNDER_120');
  });

  it('TC-SCREEN-006: should map SBP 120 to BIN_SBP_120_139', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 120,
      bodyMassIndex: 22.0,
    });

    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_120_139');
  });

  it('TC-SCREEN-007: should map SBP 139 to BIN_SBP_120_139', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 139,
      bodyMassIndex: 22.0,
    });

    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_120_139');
  });

  it('TC-SCREEN-008: should map SBP 140 to BIN_SBP_140_159', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 140,
      bodyMassIndex: 22.0,
    });

    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_140_159');
  });

  it('TC-SCREEN-009: should map SBP 179 to BIN_SBP_160_179 without crisis', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 179,
      bodyMassIndex: 22.0,
    });

    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_160_179');
    expect(response.isHypertensiveCrisis).toBe(false);
  });

  it('TC-SCREEN-010: should trigger hypertensive crisis safeguard at SBP 180 mmHg', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 42,
      gender: 'FEMALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 180,
      bodyMassIndex: 21.0,
    });

    expect(response.isHypertensiveCrisis).toBe(true);
    expect(response.binBreakdown.sbpBin).toBe('BIN_SBP_180_ABOVE');
    expect(response.riskScoreCategory).toBe('30_PERCENT_AND_ABOVE');
    expect(response.riskLevel).toBe('VERY_HIGH_RISK');
  });

  it('TC-SCREEN-011: should map BMI 19.9 to BIN_BMI_UNDER_20', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 120,
      bodyMassIndex: 19.9,
    });

    expect(response.binBreakdown.bmiBin).toBe('BIN_BMI_UNDER_20');
  });

  it('TC-SCREEN-012: should map BMI 20.0 to BIN_BMI_20_TO_24', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 120,
      bodyMassIndex: 20.0,
    });

    expect(response.binBreakdown.bmiBin).toBe('BIN_BMI_20_TO_24');
  });

  it('TC-SCREEN-013: should map BMI 24.9 to BIN_BMI_20_TO_24', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 120,
      bodyMassIndex: 24.9,
    });

    expect(response.binBreakdown.bmiBin).toBe('BIN_BMI_20_TO_24');
  });

  it('TC-SCREEN-014: should map BMI 25.0 to BIN_BMI_25_TO_29', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 120,
      bodyMassIndex: 25.0,
    });

    expect(response.binBreakdown.bmiBin).toBe('BIN_BMI_25_TO_29');
  });

  it('TC-SCREEN-015: should auto-calculate BMI from weightKg and heightCm (70kg / 170cm)', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 130,
      bodyMassIndex: null,
      weightKg: 70.0,
      heightCm: 170.0,
    });

    // 70 / (1.70 * 1.70) = 24.22145... -> 24.22
    expect(response.resolvedBmi).toBe(24.22);
    expect(response.binBreakdown.bmiBin).toBe('BIN_BMI_20_TO_24');
  });

  it('TC-SCREEN-016: should reject request when adiposity data is completely missing', () => {
    try {
      evaluateClinicalScreening({
        patientAgeYears: 50,
        gender: 'MALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 130,
        bodyMassIndex: null,
        weightKg: null,
        heightCm: null,
      });
      expect.unreachable();
    } catch (err) {
      const error = err as ClinicalValidationError;
      expect(error.status).toBe(422);
      expect(error.errorCode).toBe('ERR_MISSING_ADIPOSITY_DATA');
    }
  });

  it('TC-SCREEN-017: should reject physiological SBP anomaly below 70 or above 240 mmHg', () => {
    try {
      evaluateClinicalScreening({
        patientAgeYears: 50,
        gender: 'MALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 50,
        bodyMassIndex: 22.0,
      });
      expect.unreachable();
    } catch (err) {
      const error = err as ClinicalValidationError;
      expect(error.status).toBe(422);
      expect(error.errorCode).toBe('ERR_PHYSIOLOGICAL_SBP_OUT_OF_BOUNDS');
    }

    try {
      evaluateClinicalScreening({
        patientAgeYears: 50,
        gender: 'MALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 280,
        bodyMassIndex: 22.0,
      });
      expect.unreachable();
    } catch (err) {
      const error = err as ClinicalValidationError;
      expect(error.status).toBe(422);
      expect(error.errorCode).toBe('ERR_PHYSIOLOGICAL_SBP_OUT_OF_BOUNDS');
    }
  });

  it('TC-SCREEN-018: should reject physiological BMI anomaly below 12.0 or above 60.0', () => {
    try {
      evaluateClinicalScreening({
        patientAgeYears: 50,
        gender: 'MALE',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 120,
        bodyMassIndex: 8.5,
      });
      expect.unreachable();
    } catch (err) {
      const error = err as ClinicalValidationError;
      expect(error.status).toBe(422);
      expect(error.errorCode).toBe('ERR_PHYSIOLOGICAL_BMI_OUT_OF_BOUNDS');
    }
  });

  it('TC-SCREEN-019: should reject invalid gender with HTTP 400 Bad Request', () => {
    try {
      evaluateClinicalScreening({
        patientAgeYears: 50,
        gender: 'UNKNOWN',
        isCurrentSmoker: false,
        systolicBloodPressureMmHg: 120,
        bodyMassIndex: 22.0,
      });
      expect.unreachable();
    } catch (err) {
      const error = err as ValidationError;
      expect(error.status).toBe(400);
      expect(error.errorCode).toBe('ERR_SCHEMA_VALIDATION_FAILED');
    }
  });

  it('TC-SCREEN-020: should include full mandatory clinical disclaimer in response', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 50,
      gender: 'MALE',
      isCurrentSmoker: false,
      systolicBloodPressureMmHg: 120,
      bodyMassIndex: 22.0,
    });

    expect(response.clinicalDisclaimer).toBe(MANDATORY_CLINICAL_DISCLAIMER);
  });

  it('should use WHO SEAR Lab model when valid serum cholesterol is provided', () => {
    const response = evaluateClinicalScreening({
      patientAgeYears: 52,
      gender: 'MALE',
      isCurrentSmoker: true,
      hasDiabetes: true,
      systolicBloodPressureMmHg: 150,
      bodyMassIndex: 26.0,
      totalCholesterolMmolL: 5.5,
    });

    expect(response.chartTypeUsed).toBe('SEAR_LAB');
    expect(response.binBreakdown.cholesterolBin).toBe('BIN_CHOL_5_TO_5_9');
    expect(response.binBreakdown.bmiBin).toBeNull();
    expect(response.riskScoreCategory).toBeDefined();
    expect(response.riskLevel).toBeDefined();
  });

  it('should guarantee 100% deterministic consistency over repeated executions', () => {
    const payload = {
      patientAgeYears: 50,
      gender: 'MALE' as const,
      isCurrentSmoker: true,
      systolicBloodPressureMmHg: 150,
      bodyMassIndex: 27.2,
    };

    const first = evaluateClinicalScreening(payload, {
      evaluationId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
      calculatedAt: '2026-10-16T08:00:00.000Z',
    });

    for (let i = 0; i < 50; i++) {
      const current = evaluateClinicalScreening(payload, {
        evaluationId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
        calculatedAt: '2026-10-16T08:00:00.000Z',
      });
      expect(current).toEqual(first);
    }
  });
});
