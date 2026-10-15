import { describe, it, expect } from 'vitest';
import { evaluateClinicalScreening } from '../../../src/modules/screening/engine.js';
import { detectScreeningGaps } from '../../../src/modules/gap-detection/engine.js';

describe('Screening Gap Detection Integration, Edge Cases & SLA Benchmark (MOD-02 Checkpoint 10)', () => {
  const patientId = '018e4c7d-8a21-7291-a6b4-2e9f1a0b3c4d';
  const evalDate = '2026-10-16T08:00:00.000Z';

  describe('Integrated Pipeline: MOD-01 (Screening) + MOD-02 (Gap Detection)', () => {
    it('should seamlessly execute combined clinical screening and gap detection without data conflict', () => {
      // 1. Patient clinical input for current encounter
      const screeningInput = {
        patientAgeYears: 54,
        gender: 'MALE' as const,
        isCurrentSmoker: true,
        systolicBloodPressureMmHg: 155,
        bodyMassIndex: 28.4,
      };

      // 2. Evaluate WHO CVD 10-year risk (MOD-01)
      const whoEvaluation = evaluateClinicalScreening(screeningInput);
      expect(whoEvaluation.riskScoreCategory).toBe('10_TO_UNDER_20_PERCENT');
      expect(whoEvaluation.riskLevel).toBe('MODERATE_RISK');
      expect(whoEvaluation.chartTypeUsed).toBe('SEAR_NON_LAB');

      // 3. Evaluate SATUSEHAT screening gaps based on patient EHR history (MOD-02)
      // Patient has SBP & BMI measured today, smoking answered today, but NO glucose or waist measurement
      const gapResponse = detectScreeningGaps({
        patientId,
        evaluationDate: evalDate,
        knownRiskProfile: {
          isKnownHypertensive: true,
          isKnownDiabetic: false,
        },
        screeningRecords: [
          {
            parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
            recordedValue: screeningInput.systolicBloodPressureMmHg,
            unit: 'mmHg',
            recordedAt: evalDate,
          },
          {
            parameterCode: 'BODY_MASS_INDEX',
            recordedValue: screeningInput.bodyMassIndex,
            unit: 'kg/m2',
            recordedAt: evalDate,
          },
          {
            parameterCode: 'SMOKING_STATUS_ASSESSMENT',
            recordedValue: 'SMOKER',
            recordedAt: evalDate,
          },
        ],
      });

      // Verify Gap Engine detects the 3 unperformed parameters (Glucose, Waist, Cholesterol)
      expect(gapResponse.activeGapsCount).toBe(3);
      expect(gapResponse.overallComplianceStatus).toBe('PARTIALLY_COMPLIANT');

      const glucoseGap = gapResponse.identifiedGaps.find(
        (g) => g.parameterCode === 'FASTING_BLOOD_GLUCOSE'
      );
      expect(glucoseGap?.gapType).toBe('NEVER_PERFORMED');
      expect(glucoseGap?.severity).toBe('HIGH');

      const waistGap = gapResponse.identifiedGaps.find(
        (g) => g.parameterCode === 'WAIST_CIRCUMFERENCE'
      );
      expect(waistGap?.gapType).toBe('NEVER_PERFORMED');
      expect(waistGap?.severity).toBe('MEDIUM');

      // Zero-disease inference: WHO risk is high due to smoking & stage 1 hypertension,
      // but system does NOT declare patient has diabetes
      expect(glucoseGap?.actionableRecommendation.userGuidanceText).toContain(
        'Pemeriksaan gula darah puasa Anda belum tercatat'
      );
    });
  });

  describe('Edge Cases & Date Math Boundaries', () => {
    it('should correctly handle Leap Year date arithmetic (Feb 29 -> 365/366 days)', () => {
      // 2024 is a leap year (2024-02-29 exists)
      const leapDay = '2024-02-29T00:00:00.000Z';
      const exactOneYearLater = '2025-02-28T00:00:00.000Z'; // 365 calendar days later
      const oneYearAndOneDayLater = '2025-03-01T00:00:00.000Z'; // 366 calendar days later

      // Evaluated at exact 365 days -> Still valid
      const validResponse = detectScreeningGaps({
        patientId,
        evaluationDate: exactOneYearLater,
        screeningRecords: [
          {
            parameterCode: 'WAIST_CIRCUMFERENCE',
            recordedValue: 82.0,
            unit: 'cm',
            recordedAt: leapDay,
          },
        ],
      });
      const waistValid = validResponse.identifiedGaps.find(
        (g) => g.parameterCode === 'WAIST_CIRCUMFERENCE'
      );
      expect(waistValid).toBeUndefined(); // Within 365 days, no gap!

      // Evaluated at 366 days -> Stale
      const staleResponse = detectScreeningGaps({
        patientId,
        evaluationDate: oneYearAndOneDayLater,
        screeningRecords: [
          {
            parameterCode: 'WAIST_CIRCUMFERENCE',
            recordedValue: 82.0,
            unit: 'cm',
            recordedAt: leapDay,
          },
        ],
      });
      const waistStale = staleResponse.identifiedGaps.find(
        (g) => g.parameterCode === 'WAIST_CIRCUMFERENCE'
      );
      expect(waistStale?.gapType).toBe('STALE_DATA');
      expect(waistStale?.daysSinceLastRecorded).toBe(366);
    });

    it('should handle multi-year stale data (1200 days ago)', () => {
      const recordedAt = '2023-07-04T08:00:00.000Z';
      const response = detectScreeningGaps({
        patientId,
        evaluationDate: evalDate,
        screeningRecords: [
          {
            parameterCode: 'TOTAL_CHOLESTEROL',
            recordedValue: 5.0,
            unit: 'mmol/L',
            recordedAt,
          },
        ],
      });

      const cholGap = response.identifiedGaps.find(
        (g) => g.parameterCode === 'TOTAL_CHOLESTEROL'
      );
      expect(cholGap?.gapType).toBe('STALE_DATA');
      expect(cholGap?.daysSinceLastRecorded).toBeGreaterThan(1000);
    });

    it('should honor custom reportId and custom instance in options', () => {
      const customReportId = '11111111-2222-4333-8444-555555555555';
      const customInstance = '/api/v1/patients/123/gaps';

      const response = detectScreeningGaps(
        {
          patientId,
          evaluationDate: evalDate,
          screeningRecords: [],
        },
        {
          reportId: customReportId,
          instance: customInstance,
        }
      );

      expect(response.reportId).toBe(customReportId);
    });
  });

  describe('High-Throughput Performance SLA Benchmark', () => {
    it('should execute 1,000 gap evaluations with p99 latency < 30 ms (PRD 03 SLA: <= 30 ms)', () => {
      const requestPayload = {
        patientId,
        evaluationDate: evalDate,
        knownRiskProfile: {
          isKnownHypertensive: true,
          isKnownDiabetic: false,
        },
        screeningRecords: [
          {
            parameterCode: 'SYSTOLIC_BLOOD_PRESSURE' as const,
            recordedValue: 145,
            unit: 'mmHg',
            recordedAt: '2026-08-01T08:00:00.000Z', // 76 days ago (valid for 90d window)
          },
          {
            parameterCode: 'BODY_MASS_INDEX' as const,
            recordedValue: 27.2,
            unit: 'kg/m2',
            recordedAt: '2026-01-10T08:00:00.000Z', // 279 days ago (valid for 365d window)
          },
          {
            parameterCode: 'FASTING_BLOOD_GLUCOSE' as const,
            recordedValue: 105,
            unit: 'mg/dL',
            recordedAt: '2025-05-10T08:00:00.000Z', // 524 days ago (stale)
          },
        ],
      };

      const iterations = 1000;
      const latenciesMs: number[] = [];

      // Warmup JIT
      for (let i = 0; i < 50; i++) {
        detectScreeningGaps(requestPayload);
      }

      // Measured Benchmark Run
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        detectScreeningGaps(requestPayload);
        const end = performance.now();
        latenciesMs.push(end - start);
      }

      latenciesMs.sort((a, b) => a - b);
      const p50 = latenciesMs[Math.floor(iterations * 0.5)]!;
      const p95 = latenciesMs[Math.floor(iterations * 0.95)]!;
      const p99 = latenciesMs[Math.floor(iterations * 0.99)]!;

      // Enforce PRD 03 SLA requirement: p99 <= 30 ms
      expect(p99).toBeLessThan(30);

      // Verify in-memory execution is blazing fast (< 5ms)
      expect(p50).toBeLessThan(5);

      // Diagnostic logging
      // eslint-disable-next-line no-console
      console.log(
        `[Benchmark SLA] MOD-02 1000-eval latency: p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms, p99=${p99.toFixed(3)}ms`
      );
    });
  });
});
