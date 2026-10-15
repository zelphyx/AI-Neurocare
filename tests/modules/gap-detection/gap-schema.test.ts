import { describe, it, expect } from 'vitest';
import {
  REQUIRED_SCREENING_PARAMETERS,
  MANDATORY_GAP_DISCLAIMER,
  isPhysiologicallyValid,
  resolveValidityWindow,
  VALIDITY_WINDOWS,
  getActionableRecommendation,
  getDefaultSeverity,
} from '../../../src/modules/gap-detection/constants.js';
import {
  validateScreeningGapRequest,
  validateScreeningGapResponse,
  ScreeningGapRequestSchema,
  ScreeningGapResponseSchema,
} from '../../../src/modules/gap-detection/validators.js';
import { ValidationError } from '../../../src/shared/errors/domain-error.js';

describe('Screening Gap Types, 5-Pillar Constants & Schemas (MOD-02 Checkpoint 8)', () => {
  describe('Constants & 5-Pillar Metadata', () => {
    it('should define all 6 required PTM screening parameters', () => {
      expect(REQUIRED_SCREENING_PARAMETERS).toHaveLength(6);
      const codes = REQUIRED_SCREENING_PARAMETERS.map((p) => p.parameterCode);
      expect(codes).toContain('SYSTOLIC_BLOOD_PRESSURE');
      expect(codes).toContain('BODY_MASS_INDEX');
      expect(codes).toContain('WAIST_CIRCUMFERENCE');
      expect(codes).toContain('FASTING_BLOOD_GLUCOSE');
      expect(codes).toContain('SMOKING_STATUS_ASSESSMENT');
      expect(codes).toContain('TOTAL_CHOLESTEROL');
    });

    it('should have exact mandatory clinical disclaimer', () => {
      expect(MANDATORY_GAP_DISCLAIMER).toBe(
        'Laporan kesenjangan skrining ini merupakan alat bantu kepatuhan protokol deteksi dini PTM SATUSEHAT. Ketiadaan data pada suatu parameter BUKAN bukti tidak adanya penyakit dan BUKAN diagnosis klinis.'
      );
    });

    it('should return appropriate recommendations for parameters', () => {
      const bpRec = getActionableRecommendation('SYSTOLIC_BLOOD_PRESSURE', 'STALE_DATA');
      expect(bpRec.actionCode).toBe('ACTION_ROUTINE_ANNUAL_BP_CHECK');
      expect(bpRec.targetFacility).toContain('Posbindu');

      const invalidBpRec = getActionableRecommendation(
        'SYSTOLIC_BLOOD_PRESSURE',
        'INVALID_DATA'
      );
      expect(invalidBpRec.actionCode).toBe('ACTION_IMMEDIATE_CLINICAL_BP_CHECK');

      const glucoseRec = getActionableRecommendation('FASTING_BLOOD_GLUCOSE', 'NEVER_PERFORMED');
      expect(glucoseRec.actionCode).toBe('ACTION_PUSKESMAS_GLYCEMIC_SCREENING');
    });

    it('should return default severity correctly', () => {
      expect(getDefaultSeverity('SYSTOLIC_BLOOD_PRESSURE', 'INVALID_DATA')).toBe('CRITICAL');
      expect(getDefaultSeverity('SYSTOLIC_BLOOD_PRESSURE', 'NEVER_PERFORMED')).toBe('HIGH');
      expect(getDefaultSeverity('FASTING_BLOOD_GLUCOSE', 'STALE_DATA')).toBe('HIGH');
      expect(getDefaultSeverity('WAIST_CIRCUMFERENCE', 'NEVER_PERFORMED')).toBe('MEDIUM');
      expect(getDefaultSeverity('TOTAL_CHOLESTEROL', 'NEVER_PERFORMED')).toBe('MEDIUM');
    });
  });

  describe('Biological Plausibility Validation (isPhysiologicallyValid)', () => {
    it('should validate Systolic Blood Pressure bounds (70 - 240 mmHg)', () => {
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', 70)).toBe(true);
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', 120)).toBe(true);
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', 240)).toBe(true);
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', 69)).toBe(false);
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', 241)).toBe(false);
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', null)).toBe(false);
      expect(isPhysiologicallyValid('SYSTOLIC_BLOOD_PRESSURE', '120')).toBe(false);
    });

    it('should validate Body Mass Index bounds (12.0 - 60.0 kg/m2)', () => {
      expect(isPhysiologicallyValid('BODY_MASS_INDEX', 12.0)).toBe(true);
      expect(isPhysiologicallyValid('BODY_MASS_INDEX', 24.5)).toBe(true);
      expect(isPhysiologicallyValid('BODY_MASS_INDEX', 60.0)).toBe(true);
      expect(isPhysiologicallyValid('BODY_MASS_INDEX', 11.9)).toBe(false);
      expect(isPhysiologicallyValid('BODY_MASS_INDEX', 60.1)).toBe(false);
    });

    it('should validate Waist Circumference bounds (40.0 - 180.0 cm)', () => {
      expect(isPhysiologicallyValid('WAIST_CIRCUMFERENCE', 40.0)).toBe(true);
      expect(isPhysiologicallyValid('WAIST_CIRCUMFERENCE', 85.0)).toBe(true);
      expect(isPhysiologicallyValid('WAIST_CIRCUMFERENCE', 180.0)).toBe(true);
      expect(isPhysiologicallyValid('WAIST_CIRCUMFERENCE', 39.9)).toBe(false);
      expect(isPhysiologicallyValid('WAIST_CIRCUMFERENCE', 180.1)).toBe(false);
    });

    it('should validate Fasting Blood Glucose bounds (40 - 500 mg/dL)', () => {
      expect(isPhysiologicallyValid('FASTING_BLOOD_GLUCOSE', 40)).toBe(true);
      expect(isPhysiologicallyValid('FASTING_BLOOD_GLUCOSE', 105)).toBe(true);
      expect(isPhysiologicallyValid('FASTING_BLOOD_GLUCOSE', 500)).toBe(true);
      expect(isPhysiologicallyValid('FASTING_BLOOD_GLUCOSE', 39)).toBe(false);
      expect(isPhysiologicallyValid('FASTING_BLOOD_GLUCOSE', 501)).toBe(false);
    });

    it('should validate Total Cholesterol bounds (2.0 - 15.0 mmol/L)', () => {
      expect(isPhysiologicallyValid('TOTAL_CHOLESTEROL', 2.0)).toBe(true);
      expect(isPhysiologicallyValid('TOTAL_CHOLESTEROL', 5.2)).toBe(true);
      expect(isPhysiologicallyValid('TOTAL_CHOLESTEROL', 15.0)).toBe(true);
      expect(isPhysiologicallyValid('TOTAL_CHOLESTEROL', 1.9)).toBe(false);
      expect(isPhysiologicallyValid('TOTAL_CHOLESTEROL', 15.1)).toBe(false);
    });

    it('should validate Smoking Status categorical enum', () => {
      expect(isPhysiologicallyValid('SMOKING_STATUS_ASSESSMENT', 'SMOKER')).toBe(true);
      expect(isPhysiologicallyValid('SMOKING_STATUS_ASSESSMENT', 'NON_SMOKER')).toBe(true);
      expect(isPhysiologicallyValid('SMOKING_STATUS_ASSESSMENT', 'FORMER')).toBe(false);
      expect(isPhysiologicallyValid('SMOKING_STATUS_ASSESSMENT', 1)).toBe(false);
    });
  });

  describe('Dynamic Validity Window Resolution', () => {
    it('should return standard 365 days for normal SBP without comorbidities', () => {
      expect(resolveValidityWindow('SYSTOLIC_BLOOD_PRESSURE', 120)).toBe(
        VALIDITY_WINDOWS.STANDARD_DAYS
      );
    });

    it('should shorten SBP validity to 90 days if SBP >= 140 mmHg', () => {
      expect(resolveValidityWindow('SYSTOLIC_BLOOD_PRESSURE', 140)).toBe(
        VALIDITY_WINDOWS.HIGH_RISK_SBP_DAYS
      );
      expect(resolveValidityWindow('SYSTOLIC_BLOOD_PRESSURE', 155)).toBe(
        VALIDITY_WINDOWS.HIGH_RISK_SBP_DAYS
      );
    });

    it('should shorten SBP validity to 90 days if patient is known hypertensive even if SBP < 140', () => {
      expect(
        resolveValidityWindow('SYSTOLIC_BLOOD_PRESSURE', 125, { isKnownHypertensive: true })
      ).toBe(VALIDITY_WINDOWS.HIGH_RISK_SBP_DAYS);
    });

    it('should shorten Fasting Glucose validity to 90 days if glucose >= 126 mg/dL or known diabetic', () => {
      expect(resolveValidityWindow('FASTING_BLOOD_GLUCOSE', 95)).toBe(365);
      expect(resolveValidityWindow('FASTING_BLOOD_GLUCOSE', 130)).toBe(90);
      expect(resolveValidityWindow('FASTING_BLOOD_GLUCOSE', 95, { isKnownDiabetic: true })).toBe(
        90
      );
    });

    it('should shorten BMI validity to 180 days if BMI >= 30.0 kg/m2 (Obese)', () => {
      expect(resolveValidityWindow('BODY_MASS_INDEX', 24.0)).toBe(365);
      expect(resolveValidityWindow('BODY_MASS_INDEX', 32.5)).toBe(180);
    });

    it('should shorten Cholesterol validity to 180 days if cholesterol >= 6.2 mmol/L', () => {
      expect(resolveValidityWindow('TOTAL_CHOLESTEROL', 5.0)).toBe(365);
      expect(resolveValidityWindow('TOTAL_CHOLESTEROL', 6.5)).toBe(180);
    });
  });

  describe('Request & Response Zod Schemas', () => {
    const validPatientId = '018e4c7d-8a21-7291-a6b4-2e9f1a0b3c4d';

    it('should validate valid ScreeningGapRequest with multiple records', () => {
      const validPayload = {
        patientId: validPatientId,
        evaluationDate: '2026-10-16T08:00:00.000Z',
        knownRiskProfile: {
          isKnownHypertensive: false,
          isKnownDiabetic: false,
        },
        screeningRecords: [
          {
            parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
            recordedValue: 130,
            unit: 'mmHg',
            recordedAt: '2026-10-10T08:00:00.000Z',
          },
        ],
      };

      const parsed = validateScreeningGapRequest(validPayload);
      expect(parsed.patientId).toBe(validPatientId);
      expect(parsed.screeningRecords).toHaveLength(1);
    });

    it('should accept empty screeningRecords array (representing patient never screened)', () => {
      const payload = {
        patientId: validPatientId,
        screeningRecords: [],
      };

      const parsed = validateScreeningGapRequest(payload);
      expect(parsed.screeningRecords).toHaveLength(0);
    });

    it('should reject invalid non-UUID patientId with HTTP 400 ValidationError', () => {
      expect(() => {
        validateScreeningGapRequest({
          patientId: 'not-a-uuid',
          screeningRecords: [],
        });
      }).toThrow(ValidationError);

      try {
        validateScreeningGapRequest({
          patientId: 'not-a-uuid',
          screeningRecords: [],
        });
      } catch (err) {
        const error = err as ValidationError;
        expect(error.status).toBe(400);
        expect(error.errorCode).toBe('ERR_GAP_REQUEST_VALIDATION_FAILED');
      }
    });

    it('should reject invalid parameterCode with HTTP 400', () => {
      expect(() => {
        validateScreeningGapRequest({
          patientId: validPatientId,
          screeningRecords: [
            {
              parameterCode: 'INVALID_PARAMETER_NAME',
              recordedValue: 120,
            },
          ],
        });
      }).toThrow(ValidationError);
    });

    it('should validate ScreeningGapResponseSchema successfully', () => {
      const mockResponse = {
        reportId: '018e4c7d-8a21-7291-a6b4-2e9f1a0b3c4e',
        patientId: validPatientId,
        evaluationDate: '2026-10-16T08:00:00.000Z',
        overallComplianceStatus: 'PARTIALLY_COMPLIANT',
        totalParametersEvaluated: 6,
        activeGapsCount: 2,
        highestSeverity: 'HIGH',
        identifiedGaps: [
          {
            parameterCode: 'FASTING_BLOOD_GLUCOSE',
            parameterName: 'Gula Darah Puasa (GDP)',
            pillarName: 'Pilar 4: Deteksi Dini Diabetes Melitus',
            gapType: 'NEVER_PERFORMED',
            severity: 'HIGH',
            daysSinceLastRecorded: null,
            validityWindowDays: 365,
            recordedValue: null,
            actionableRecommendation: {
              actionCode: 'ACTION_PUSKESMAS_GLYCEMIC_SCREENING',
              targetFacility: 'Laboratorium Puskesmas',
              userGuidanceText: 'Lakukan pemeriksaan glikemik berkala.',
            },
          },
        ],
        clinicalDisclaimer: MANDATORY_GAP_DISCLAIMER,
      };

      const validated = validateScreeningGapResponse(mockResponse);
      expect(validated.overallComplianceStatus).toBe('PARTIALLY_COMPLIANT');
      expect(validated.identifiedGaps).toHaveLength(1);
    });
  });
});
