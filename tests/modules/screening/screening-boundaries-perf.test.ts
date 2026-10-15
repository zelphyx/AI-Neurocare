import { describe, it, expect } from 'vitest';
import {
  mapAgeToBin,
  mapSbpToBin,
  mapBmiToBin,
  mapCholesterolToBin,
  resolveBmi,
} from '../../../src/modules/screening/binning.js';
import { evaluateClinicalScreening } from '../../../src/modules/screening/engine.js';
import { ClinicalValidationError } from '../../../src/shared/errors/domain-error.js';

describe('Screening Boundary Polish & Performance Benchmark (MOD-01 Checkpoint 7)', () => {
  describe('Exhaustive Binning Boundary Checks', () => {
    it('should map all Age boundaries accurately', () => {
      expect(mapAgeToBin(40)).toBe('BIN_AGE_40_44');
      expect(mapAgeToBin(44)).toBe('BIN_AGE_40_44');
      expect(mapAgeToBin(45)).toBe('BIN_AGE_45_49');
      expect(mapAgeToBin(49)).toBe('BIN_AGE_45_49');
      expect(mapAgeToBin(50)).toBe('BIN_AGE_50_54');
      expect(mapAgeToBin(54)).toBe('BIN_AGE_50_54');
      expect(mapAgeToBin(55)).toBe('BIN_AGE_55_59');
      expect(mapAgeToBin(59)).toBe('BIN_AGE_55_59');

      expect(() => mapAgeToBin(39)).toThrow(ClinicalValidationError);
      expect(() => mapAgeToBin(60)).toThrow(ClinicalValidationError);
    });

    it('should map all SBP boundaries accurately', () => {
      expect(mapSbpToBin(70)).toBe('BIN_SBP_UNDER_120');
      expect(mapSbpToBin(119)).toBe('BIN_SBP_UNDER_120');
      expect(mapSbpToBin(120)).toBe('BIN_SBP_120_139');
      expect(mapSbpToBin(139)).toBe('BIN_SBP_120_139');
      expect(mapSbpToBin(140)).toBe('BIN_SBP_140_159');
      expect(mapSbpToBin(159)).toBe('BIN_SBP_140_159');
      expect(mapSbpToBin(160)).toBe('BIN_SBP_160_179');
      expect(mapSbpToBin(179)).toBe('BIN_SBP_160_179');
      expect(mapSbpToBin(180)).toBe('BIN_SBP_180_ABOVE');
      expect(mapSbpToBin(240)).toBe('BIN_SBP_180_ABOVE');
    });

    it('should map all BMI boundaries accurately', () => {
      expect(mapBmiToBin(12.0)).toBe('BIN_BMI_UNDER_20');
      expect(mapBmiToBin(19.99)).toBe('BIN_BMI_UNDER_20');
      expect(mapBmiToBin(20.0)).toBe('BIN_BMI_20_TO_24');
      expect(mapBmiToBin(24.99)).toBe('BIN_BMI_20_TO_24');
      expect(mapBmiToBin(25.0)).toBe('BIN_BMI_25_TO_29');
      expect(mapBmiToBin(29.99)).toBe('BIN_BMI_25_TO_29');
      expect(mapBmiToBin(30.0)).toBe('BIN_BMI_30_TO_34');
      expect(mapBmiToBin(34.99)).toBe('BIN_BMI_30_TO_34');
      expect(mapBmiToBin(35.0)).toBe('BIN_BMI_35_ABOVE');
      expect(mapBmiToBin(60.0)).toBe('BIN_BMI_35_ABOVE');
    });

    it('should map all Cholesterol boundaries accurately', () => {
      expect(mapCholesterolToBin(2.0)).toBe('BIN_CHOL_UNDER_4');
      expect(mapCholesterolToBin(3.99)).toBe('BIN_CHOL_UNDER_4');
      expect(mapCholesterolToBin(4.0)).toBe('BIN_CHOL_4_TO_4_9');
      expect(mapCholesterolToBin(4.99)).toBe('BIN_CHOL_4_TO_4_9');
      expect(mapCholesterolToBin(5.0)).toBe('BIN_CHOL_5_TO_5_9');
      expect(mapCholesterolToBin(5.99)).toBe('BIN_CHOL_5_TO_5_9');
      expect(mapCholesterolToBin(6.0)).toBe('BIN_CHOL_6_TO_6_9');
      expect(mapCholesterolToBin(6.99)).toBe('BIN_CHOL_6_TO_6_9');
      expect(mapCholesterolToBin(7.0)).toBe('BIN_CHOL_7_ABOVE');
      expect(mapCholesterolToBin(15.0)).toBe('BIN_CHOL_7_ABOVE');
    });

    it('should test resolveBmi direct error branches', () => {
      // Direct BMI
      expect(resolveBmi({ bodyMassIndex: 23.456 })).toBe(23.46);

      // Height <= 0
      expect(() => resolveBmi({ weightKg: 70, heightCm: 0 })).toThrow(
        ClinicalValidationError
      );

      // Missing adiposity
      expect(() => resolveBmi({})).toThrow(ClinicalValidationError);

      // Calculated BMI below physiological bound (e.g. 30kg / 200cm -> BMI = 7.5)
      expect(() => resolveBmi({ weightKg: 30, heightCm: 200 })).toThrow(
        ClinicalValidationError
      );

      // Calculated BMI above physiological bound (e.g. 250kg / 120cm -> BMI = 173.6)
      expect(() => resolveBmi({ weightKg: 250, heightCm: 120 })).toThrow(
        ClinicalValidationError
      );
    });
  });

  describe('Model Cross-Checking (Lab vs Non-Lab Combinations)', () => {
    it('should evaluate Female Non-Smoker Non-Diabetic in Lab model', () => {
      const response = evaluateClinicalScreening({
        patientAgeYears: 45,
        gender: 'FEMALE',
        isCurrentSmoker: false,
        hasDiabetes: false,
        systolicBloodPressureMmHg: 130,
        bodyMassIndex: 22.0,
        totalCholesterolMmolL: 4.5,
      });

      expect(response.chartTypeUsed).toBe('SEAR_LAB');
      expect(response.binBreakdown.cholesterolBin).toBe('BIN_CHOL_4_TO_4_9');
      expect(response.binBreakdown.bmiBin).toBeNull();
      expect(response.riskLevel).toBe('LOW_RISK');
    });

    it('should evaluate Female Smoker Diabetic in Lab model with increased risk', () => {
      const response = evaluateClinicalScreening({
        patientAgeYears: 56,
        gender: 'FEMALE',
        isCurrentSmoker: true,
        hasDiabetes: true,
        systolicBloodPressureMmHg: 165,
        bodyMassIndex: 28.0,
        totalCholesterolMmolL: 6.5,
      });

      expect(response.chartTypeUsed).toBe('SEAR_LAB');
      expect(response.binBreakdown.cholesterolBin).toBe('BIN_CHOL_6_TO_6_9');
      expect(response.riskScoreCategory).toBe('30_PERCENT_AND_ABOVE');
      expect(response.riskLevel).toBe('VERY_HIGH_RISK');
    });
  });

  describe('High-Throughput Performance SLA Benchmark', () => {
    it('should execute 1,000 evaluations with p99 latency < 20 ms (PRD 02 SLA: <= 20 ms)', () => {
      const samplePayload = {
        patientAgeYears: 52,
        gender: 'MALE' as const,
        isCurrentSmoker: true,
        systolicBloodPressureMmHg: 145,
        bodyMassIndex: 26.5,
      };

      const iterations = 1000;
      const latenciesMs: number[] = [];

      // Warmup JIT
      for (let i = 0; i < 50; i++) {
        evaluateClinicalScreening(samplePayload);
      }

      // Measured Benchmark Run
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        evaluateClinicalScreening(samplePayload);
        const end = performance.now();
        latenciesMs.push(end - start);
      }

      latenciesMs.sort((a, b) => a - b);
      const p50 = latenciesMs[Math.floor(iterations * 0.5)]!;
      const p95 = latenciesMs[Math.floor(iterations * 0.95)]!;
      const p99 = latenciesMs[Math.floor(iterations * 0.99)]!;

      // Enforce PRD 02 SLA requirement: p99 <= 20 ms
      expect(p99).toBeLessThan(20);

      // Verify in-memory execution is blazing fast (< 5ms)
      expect(p50).toBeLessThan(5);

      // Diagnostic logging
      // eslint-disable-next-line no-console
      console.log(
        `[Benchmark SLA] MOD-01 1000-eval latency: p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms, p99=${p99.toFixed(3)}ms`
      );
    });
  });
});
