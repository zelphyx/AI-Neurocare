import { ClinicalValidationError } from '../../shared/errors/domain-error.js';
import { CLINICAL_CONSTANTS, SCREENING_ERROR_CODES } from './constants.js';
import type { AgeBin, SbpBin, BmiBin, CholesterolBin } from './types.js';

/**
 * Maps continuous patient chronological age to discrete WHO age bin (40-59 years)
 */
export function mapAgeToBin(ageYears: number): AgeBin {
  if (ageYears >= 40 && ageYears <= 44) {
    return 'BIN_AGE_40_44';
  }
  if (ageYears >= 45 && ageYears <= 49) {
    return 'BIN_AGE_45_49';
  }
  if (ageYears >= 50 && ageYears <= 54) {
    return 'BIN_AGE_50_54';
  }
  if (ageYears >= 55 && ageYears <= 59) {
    return 'BIN_AGE_55_59';
  }

  throw new ClinicalValidationError({
    instance: '/api/v1/screening/evaluate',
    errorCode: SCREENING_ERROR_CODES.ERR_AGE_OUT_OF_STUDY_RANGE,
    detail: `Usia ${ageYears} tahun di luar rentang populasi studi WHO SEAR (40-59 tahun).`,
  });
}

/**
 * Maps continuous Systolic Blood Pressure (SBP) to discrete WHO SBP bin
 */
export function mapSbpToBin(sbpMmHg: number): SbpBin {
  if (sbpMmHg < 120) {
    return 'BIN_SBP_UNDER_120';
  }
  if (sbpMmHg <= 139) {
    return 'BIN_SBP_120_139';
  }
  if (sbpMmHg <= 159) {
    return 'BIN_SBP_140_159';
  }
  if (sbpMmHg <= 179) {
    return 'BIN_SBP_160_179';
  }
  return 'BIN_SBP_180_ABOVE';
}

/**
 * Maps continuous Body Mass Index (BMI) to discrete WHO BMI bin
 */
export function mapBmiToBin(bmi: number): BmiBin {
  if (bmi < 20.0) {
    return 'BIN_BMI_UNDER_20';
  }
  if (bmi < 25.0) {
    return 'BIN_BMI_20_TO_24';
  }
  if (bmi < 30.0) {
    return 'BIN_BMI_25_TO_29';
  }
  if (bmi < 35.0) {
    return 'BIN_BMI_30_TO_34';
  }
  return 'BIN_BMI_35_ABOVE';
}

/**
 * Maps continuous serum cholesterol (mmol/L) to discrete WHO cholesterol bin
 */
export function mapCholesterolToBin(cholesterolMmolL: number): CholesterolBin {
  if (cholesterolMmolL < 4.0) {
    return 'BIN_CHOL_UNDER_4';
  }
  if (cholesterolMmolL < 5.0) {
    return 'BIN_CHOL_4_TO_4_9';
  }
  if (cholesterolMmolL < 6.0) {
    return 'BIN_CHOL_5_TO_5_9';
  }
  if (cholesterolMmolL < 7.0) {
    return 'BIN_CHOL_6_TO_6_9';
  }
  return 'BIN_CHOL_7_ABOVE';
}

export interface AdiposityInput {
  bodyMassIndex?: number | null | undefined;
  weightKg?: number | null | undefined;
  heightCm?: number | null | undefined;
}

/**
 * Resolves Body Mass Index (BMI) deterministically:
 * - Uses direct BMI if provided
 * - Or calculates BMI from weight (kg) and height (cm) rounded to 2 decimal places: weight / (height / 100)^2
 * - Enforces biological boundaries (12.0 - 60.0 kg/m^2)
 */
export function resolveBmi(
  input: AdiposityInput,
  instance: string = '/api/v1/screening/evaluate'
): number {
  let resolved: number | null = null;

  if (input.bodyMassIndex !== null && input.bodyMassIndex !== undefined) {
    resolved = Math.round(input.bodyMassIndex * 100) / 100;
  } else if (
    input.weightKg !== null &&
    input.weightKg !== undefined &&
    input.heightCm !== null &&
    input.heightCm !== undefined
  ) {
    const heightMeters = input.heightCm / 100.0;
    if (heightMeters <= 0) {
      throw new ClinicalValidationError({
        instance,
        errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_HEIGHT_OUT_OF_BOUNDS,
        detail: 'Tinggi badan harus lebih besar dari 0 cm.',
      });
    }
    const computed = input.weightKg / (heightMeters * heightMeters);
    resolved = Math.round(computed * 100) / 100;
  } else {
    throw new ClinicalValidationError({
      instance,
      errorCode: SCREENING_ERROR_CODES.ERR_MISSING_ADIPOSITY_DATA,
      detail:
        'Data adipositas tidak lengkap. Wajib menyertakan parameter bodyMassIndex ATAU kombinasi weightKg dan heightCm.',
    });
  }

  if (
    resolved < CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_BMI ||
    resolved > CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_BMI
  ) {
    throw new ClinicalValidationError({
      instance,
      errorCode: SCREENING_ERROR_CODES.ERR_PHYSIOLOGICAL_BMI_OUT_OF_BOUNDS,
      detail: `Nilai BMI (${resolved} kg/m²) berada di luar batas biologis yang masuk akal (${CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_BMI}-${CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_BMI} kg/m²).`,
      invalidParams: [
        {
          field: 'bodyMassIndex',
          rejectedValue: resolved,
          reason: `Nilai BMI harus berada dalam rentang fisiologis ${CLINICAL_CONSTANTS.MIN_PHYSIOLOGICAL_BMI} hingga ${CLINICAL_CONSTANTS.MAX_PHYSIOLOGICAL_BMI} kg/m².`,
        },
      ],
    });
  }

  return resolved;
}
