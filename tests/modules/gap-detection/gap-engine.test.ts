import { describe, it, expect } from 'vitest';
import { detectScreeningGaps } from '../../../src/modules/gap-detection/engine.js';
import { MANDATORY_GAP_DISCLAIMER } from '../../../src/modules/gap-detection/constants.js';

describe('Screening Gap Detection Engine & PRD 03 Test Cases (MOD-02 Checkpoint 9)', () => {
  const patientId = '018e4c7d-8a21-7291-a6b4-2e9f1a0b3c4d';
  const evalDate = '2026-10-16T08:00:00.000Z';

  // Helper to build a timestamp days ago relative to 2026-10-16T08:00:00.000Z
  function daysAgoIso(days: number): string {
    const base = new Date('2026-10-16T08:00:00.000Z');
    base.setUTCDate(base.getUTCDate() - days);
    return base.toISOString();
  }

  it('TC-GAP-001: should detect FULLY_COMPLIANT status when all 6 parameters are fresh (5 days ago)', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 120,
          unit: 'mmHg',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'BODY_MASS_INDEX',
          recordedValue: 23.5,
          unit: 'kg/m2',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'WAIST_CIRCUMFERENCE',
          recordedValue: 80.0,
          unit: 'cm',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'FASTING_BLOOD_GLUCOSE',
          recordedValue: 95,
          unit: 'mg/dL',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'SMOKING_STATUS_ASSESSMENT',
          recordedValue: 'NON_SMOKER',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'TOTAL_CHOLESTEROL',
          recordedValue: 4.8,
          unit: 'mmol/L',
          recordedAt: daysAgoIso(5),
        },
      ],
    });

    expect(response.totalParametersEvaluated).toBe(6);
    expect(response.activeGapsCount).toBe(0);
    expect(response.overallComplianceStatus).toBe('FULLY_COMPLIANT');
    expect(response.highestSeverity).toBe('NONE');
    expect(response.identifiedGaps).toHaveLength(0);
  });

  it('TC-GAP-002: should detect NEVER_PERFORMED for all parameters when screeningRecords is empty', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [],
    });

    expect(response.totalParametersEvaluated).toBe(6);
    expect(response.activeGapsCount).toBe(6);
    expect(response.overallComplianceStatus).toBe('NON_COMPLIANT');
    expect(response.highestSeverity).toBe('HIGH');

    for (const gap of response.identifiedGaps) {
      expect(gap.gapType).toBe('NEVER_PERFORMED');
      expect(gap.daysSinceLastRecorded).toBeNull();
      expect(gap.recordedValue).toBeNull();
      expect(gap.actionableRecommendation.userGuidanceText).toBeDefined();
    }
  });

  it('TC-GAP-003: should flag SBP recorded 370 days ago as STALE_DATA (>365 days)', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 120,
          unit: 'mmHg',
          recordedAt: daysAgoIso(370),
        },
      ],
    });

    const sbpGap = response.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap).toBeDefined();
    expect(sbpGap?.gapType).toBe('STALE_DATA');
    expect(sbpGap?.daysSinceLastRecorded).toBe(370);
    expect(sbpGap?.severity).toBe('HIGH');
    expect(sbpGap?.validityWindowDays).toBe(365);
  });

  it('TC-GAP-004: should accept SBP recorded exactly 365 days ago as valid (no gap on SBP)', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 120,
          unit: 'mmHg',
          recordedAt: daysAgoIso(365),
        },
      ],
    });

    const sbpGap = response.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap).toBeUndefined(); // Exactly 365 days is within standard validity window!
  });

  it('TC-GAP-005: should flag SBP recorded 100 days ago as STALE_DATA when patient is hypertensive (90-day window)', () => {
    // SBP = 150 mmHg triggers 90-day window
    const responseWithHighSbp = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 150,
          unit: 'mmHg',
          recordedAt: daysAgoIso(100),
        },
      ],
    });

    const sbpGap1 = responseWithHighSbp.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap1).toBeDefined();
    expect(sbpGap1?.gapType).toBe('STALE_DATA');
    expect(sbpGap1?.validityWindowDays).toBe(90);
    expect(sbpGap1?.daysSinceLastRecorded).toBe(100);

    // Patient with normal SBP (125 mmHg) but known hypertensive comorbidity
    const responseWithComorbidity = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      knownRiskProfile: {
        isKnownHypertensive: true,
      },
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 125,
          unit: 'mmHg',
          recordedAt: daysAgoIso(100),
        },
      ],
    });

    const sbpGap2 = responseWithComorbidity.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap2).toBeDefined();
    expect(sbpGap2?.gapType).toBe('STALE_DATA');
    expect(sbpGap2?.validityWindowDays).toBe(90);
  });

  it('TC-GAP-006: should flag biologically implausible SBP (e.g. 30 or 290 mmHg) as INVALID_DATA / CRITICAL', () => {
    const responseLow = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 30,
          unit: 'mmHg',
          recordedAt: daysAgoIso(1),
        },
      ],
    });

    const sbpGap = responseLow.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap?.gapType).toBe('INVALID_DATA');
    expect(sbpGap?.severity).toBe('CRITICAL');
    expect(sbpGap?.actionableRecommendation.actionCode).toBe('ACTION_IMMEDIATE_CLINICAL_BP_CHECK');
    expect(responseLow.overallComplianceStatus).toBe('ACTION_REQUIRED_CRITICAL');
    expect(responseLow.highestSeverity).toBe('CRITICAL');

    const responseHigh = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 290,
          unit: 'mmHg',
          recordedAt: daysAgoIso(1),
        },
      ],
    });

    const sbpGapHigh = responseHigh.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGapHigh?.gapType).toBe('INVALID_DATA');
    expect(sbpGapHigh?.severity).toBe('CRITICAL');
  });

  it('TC-GAP-007: should flag biologically implausible BMI (e.g. 9.0 or 70.0 kg/m2) as INVALID_DATA / CRITICAL', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'BODY_MASS_INDEX',
          recordedValue: 9.0,
          unit: 'kg/m2',
          recordedAt: daysAgoIso(10),
        },
      ],
    });

    const bmiGap = response.identifiedGaps.find((g) => g.parameterCode === 'BODY_MASS_INDEX');
    expect(bmiGap?.gapType).toBe('INVALID_DATA');
    expect(bmiGap?.severity).toBe('CRITICAL');
  });

  it('TC-GAP-008: should flag missing recordedValue in transaction as MISSING_DATA', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: null,
          unit: 'mmHg',
          recordedAt: daysAgoIso(1),
        },
      ],
    });

    const sbpGap = response.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap?.gapType).toBe('MISSING_DATA');
    expect(sbpGap?.severity).toBe('HIGH');
  });

  it('TC-GAP-009: should flag future timestamp as INVALID_DATA with CRITICAL severity', () => {
    // 2 days in the future relative to evalDate
    const futureDate = new Date('2026-10-18T08:00:00.000Z').toISOString();

    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 120,
          unit: 'mmHg',
          recordedAt: futureDate,
        },
      ],
    });

    const sbpGap = response.identifiedGaps.find(
      (g) => g.parameterCode === 'SYSTOLIC_BLOOD_PRESSURE'
    );
    expect(sbpGap?.gapType).toBe('INVALID_DATA');
    expect(sbpGap?.severity).toBe('CRITICAL');
    expect(response.overallComplianceStatus).toBe('ACTION_REQUIRED_CRITICAL');
  });

  it('TC-GAP-010: should verify that response clinicalDisclaimer is present and exact', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [],
    });

    expect(response.clinicalDisclaimer).toBe(MANDATORY_GAP_DISCLAIMER);
  });

  it('should enforce zero disease inference: missing glucose should NOT state or conclude diabetes', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 120,
          unit: 'mmHg',
          recordedAt: daysAgoIso(5),
        },
      ],
    });

    const glucoseGap = response.identifiedGaps.find(
      (g) => g.parameterCode === 'FASTING_BLOOD_GLUCOSE'
    );
    expect(glucoseGap).toBeDefined();
    expect(glucoseGap?.gapType).toBe('NEVER_PERFORMED');

    // Verify guidance suggests screening, not diagnosing diabetes
    expect(glucoseGap?.actionableRecommendation.userGuidanceText).toContain(
      'Pemeriksaan gula darah puasa Anda belum tercatat'
    );
    expect(glucoseGap?.actionableRecommendation.userGuidanceText).not.toContain(
      'Anda positif diabetes'
    );
  });

  it('should sort identified gaps with highest severity first (CRITICAL -> HIGH -> MEDIUM -> LOW)', () => {
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 300, // INVALID_DATA -> CRITICAL
          recordedAt: daysAgoIso(1),
        },
        {
          parameterCode: 'FASTING_BLOOD_GLUCOSE',
          recordedValue: 110,
          recordedAt: daysAgoIso(400), // STALE_DATA -> HIGH
        },
        {
          parameterCode: 'WAIST_CIRCUMFERENCE',
          recordedValue: null, // MISSING_DATA -> HIGH
        },
        {
          parameterCode: 'TOTAL_CHOLESTEROL',
          recordedValue: null, // NEVER_PERFORMED / MISSING -> MEDIUM
        },
      ],
    });

    expect(response.identifiedGaps[0]?.severity).toBe('CRITICAL');
    expect(response.identifiedGaps[0]?.parameterCode).toBe('SYSTOLIC_BLOOD_PRESSURE');
  });

  it('should use current date when evaluationDate is not provided in request', () => {
    const response = detectScreeningGaps({
      patientId,
      screeningRecords: [],
    });

    expect(response.evaluationDate).toBeDefined();
    expect(new Date(response.evaluationDate).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('should evaluate to PARTIALLY_COMPLIANT when only 1 or 2 non-critical parameters are missing', () => {
    // 5 fresh parameters, only 1 missing (TOTAL_CHOLESTEROL)
    const response = detectScreeningGaps({
      patientId,
      evaluationDate: evalDate,
      screeningRecords: [
        {
          parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
          recordedValue: 120,
          unit: 'mmHg',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'BODY_MASS_INDEX',
          recordedValue: 22.0,
          unit: 'kg/m2',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'WAIST_CIRCUMFERENCE',
          recordedValue: 80.0,
          unit: 'cm',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'FASTING_BLOOD_GLUCOSE',
          recordedValue: 90,
          unit: 'mg/dL',
          recordedAt: daysAgoIso(5),
        },
        {
          parameterCode: 'SMOKING_STATUS_ASSESSMENT',
          recordedValue: 'NON_SMOKER',
          recordedAt: daysAgoIso(5),
        },
      ],
    });

    expect(response.activeGapsCount).toBe(1);
    expect(response.overallComplianceStatus).toBe('PARTIALLY_COMPLIANT');
    expect(response.highestSeverity).toBe('MEDIUM');
  });
});
