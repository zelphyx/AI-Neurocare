import type {
  ScreeningParameterCode,
  GapSeverity,
  HighestSeverity,
  KnownRiskProfile,
  ActionableRecommendation,
  GapType,
} from './types.js';

export const MANDATORY_GAP_DISCLAIMER =
  'Laporan kesenjangan skrining ini merupakan alat bantu kepatuhan protokol deteksi dini PTM SATUSEHAT. Ketiadaan data pada suatu parameter BUKAN bukti tidak adanya penyakit dan BUKAN diagnosis klinis.';

export interface ParameterMetadata {
  parameterCode: ScreeningParameterCode;
  parameterName: string;
  pillarName: string;
  defaultUnit: string | null;
}

export const REQUIRED_SCREENING_PARAMETERS: readonly ParameterMetadata[] = [
  {
    parameterCode: 'SYSTOLIC_BLOOD_PRESSURE',
    parameterName: 'Tekanan Darah Sistolik',
    pillarName: 'Pilar 1: Deteksi Dini Hipertensi',
    defaultUnit: 'mmHg',
  },
  {
    parameterCode: 'BODY_MASS_INDEX',
    parameterName: 'Indeks Massa Tubuh (IMT)',
    pillarName: 'Pilar 2: Deteksi Dini Obesitas Umum',
    defaultUnit: 'kg/m2',
  },
  {
    parameterCode: 'WAIST_CIRCUMFERENCE',
    parameterName: 'Lingkar Perut',
    pillarName: 'Pilar 3: Deteksi Dini Obesitas Sentral',
    defaultUnit: 'cm',
  },
  {
    parameterCode: 'FASTING_BLOOD_GLUCOSE',
    parameterName: 'Gula Darah Puasa (GDP)',
    pillarName: 'Pilar 4: Deteksi Dini Diabetes Melitus',
    defaultUnit: 'mg/dL',
  },
  {
    parameterCode: 'SMOKING_STATUS_ASSESSMENT',
    parameterName: 'Skrining Perilaku Merokok',
    pillarName: 'Pilar 5: Evaluasi Perilaku Berisiko',
    defaultUnit: null,
  },
  {
    parameterCode: 'TOTAL_CHOLESTEROL',
    parameterName: 'Kolesterol Serum Total',
    pillarName: 'Parameter Sekunder: Profil Lipid',
    defaultUnit: 'mmol/L',
  },
] as const;

export const PHYSIOLOGICAL_BOUNDS = {
  SYSTOLIC_BLOOD_PRESSURE: { min: 70, max: 240, highRiskThreshold: 140 },
  BODY_MASS_INDEX: { min: 12.0, max: 60.0, highRiskThreshold: 30.0 },
  WAIST_CIRCUMFERENCE: { min: 40.0, max: 180.0, maleThreshold: 90.0, femaleThreshold: 80.0 },
  FASTING_BLOOD_GLUCOSE: { min: 40, max: 500, highRiskThreshold: 126 },
  TOTAL_CHOLESTEROL: { min: 2.0, max: 15.0, highRiskThreshold: 6.2 },
} as const;

export const VALIDITY_WINDOWS = {
  STANDARD_DAYS: 365,
  HIGH_RISK_SBP_DAYS: 90,
  HIGH_RISK_GLUCOSE_DAYS: 90,
  HIGH_RISK_BMI_DAYS: 180,
  HIGH_RISK_CHOLESTEROL_DAYS: 180,
} as const;

export const SEVERITY_WEIGHTS: Record<HighestSeverity, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/**
 * Checks if numeric or categorical parameter value is biologically plausible
 */
export function isPhysiologicallyValid(
  parameterCode: ScreeningParameterCode,
  value: unknown
): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (parameterCode === 'SMOKING_STATUS_ASSESSMENT') {
    return value === 'SMOKER' || value === 'NON_SMOKER';
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    return false;
  }

  switch (parameterCode) {
    case 'SYSTOLIC_BLOOD_PRESSURE':
      return (
        value >= PHYSIOLOGICAL_BOUNDS.SYSTOLIC_BLOOD_PRESSURE.min &&
        value <= PHYSIOLOGICAL_BOUNDS.SYSTOLIC_BLOOD_PRESSURE.max
      );
    case 'BODY_MASS_INDEX':
      return (
        value >= PHYSIOLOGICAL_BOUNDS.BODY_MASS_INDEX.min &&
        value <= PHYSIOLOGICAL_BOUNDS.BODY_MASS_INDEX.max
      );
    case 'WAIST_CIRCUMFERENCE':
      return (
        value >= PHYSIOLOGICAL_BOUNDS.WAIST_CIRCUMFERENCE.min &&
        value <= PHYSIOLOGICAL_BOUNDS.WAIST_CIRCUMFERENCE.max
      );
    case 'FASTING_BLOOD_GLUCOSE':
      return (
        value >= PHYSIOLOGICAL_BOUNDS.FASTING_BLOOD_GLUCOSE.min &&
        value <= PHYSIOLOGICAL_BOUNDS.FASTING_BLOOD_GLUCOSE.max
      );
    case 'TOTAL_CHOLESTEROL':
      return (
        value >= PHYSIOLOGICAL_BOUNDS.TOTAL_CHOLESTEROL.min &&
        value <= PHYSIOLOGICAL_BOUNDS.TOTAL_CHOLESTEROL.max
      );
  }
}

/**
 * Resolves validity window (in days) dynamically based on clinical risk profile
 */
export function resolveValidityWindow(
  parameterCode: ScreeningParameterCode,
  recordedValue: unknown,
  riskProfile?: KnownRiskProfile | undefined
): number {
  switch (parameterCode) {
    case 'SYSTOLIC_BLOOD_PRESSURE': {
      const isHighSbp =
        typeof recordedValue === 'number' &&
        recordedValue >= PHYSIOLOGICAL_BOUNDS.SYSTOLIC_BLOOD_PRESSURE.highRiskThreshold;
      const isKnownHypertensive = riskProfile?.isKnownHypertensive === true;
      if (isHighSbp || isKnownHypertensive) {
        return VALIDITY_WINDOWS.HIGH_RISK_SBP_DAYS;
      }
      return VALIDITY_WINDOWS.STANDARD_DAYS;
    }

    case 'FASTING_BLOOD_GLUCOSE': {
      const isHighGlucose =
        typeof recordedValue === 'number' &&
        recordedValue >= PHYSIOLOGICAL_BOUNDS.FASTING_BLOOD_GLUCOSE.highRiskThreshold;
      const isKnownDiabetic = riskProfile?.isKnownDiabetic === true;
      if (isHighGlucose || isKnownDiabetic) {
        return VALIDITY_WINDOWS.HIGH_RISK_GLUCOSE_DAYS;
      }
      return VALIDITY_WINDOWS.STANDARD_DAYS;
    }

    case 'BODY_MASS_INDEX': {
      if (
        typeof recordedValue === 'number' &&
        recordedValue >= PHYSIOLOGICAL_BOUNDS.BODY_MASS_INDEX.highRiskThreshold
      ) {
        return VALIDITY_WINDOWS.HIGH_RISK_BMI_DAYS;
      }
      return VALIDITY_WINDOWS.STANDARD_DAYS;
    }

    case 'TOTAL_CHOLESTEROL': {
      if (
        typeof recordedValue === 'number' &&
        recordedValue >= PHYSIOLOGICAL_BOUNDS.TOTAL_CHOLESTEROL.highRiskThreshold
      ) {
        return VALIDITY_WINDOWS.HIGH_RISK_CHOLESTEROL_DAYS;
      }
      return VALIDITY_WINDOWS.STANDARD_DAYS;
    }

    case 'WAIST_CIRCUMFERENCE':
    case 'SMOKING_STATUS_ASSESSMENT':
    default:
      return VALIDITY_WINDOWS.STANDARD_DAYS;
  }
}

/**
 * Generates tailored action recommendations for each parameter and gap condition
 */
export function getActionableRecommendation(
  parameterCode: ScreeningParameterCode,
  gapType: GapType
): ActionableRecommendation {
  if (gapType === 'INVALID_DATA') {
    if (parameterCode === 'SYSTOLIC_BLOOD_PRESSURE') {
      return {
        actionCode: 'ACTION_IMMEDIATE_CLINICAL_BP_CHECK',
        targetFacility: 'Fasilitas Pelayanan Kesehatan / IGD / Puskesmas',
        userGuidanceText:
          'Data tekanan darah Anda memerlukan verifikasi ulang segera. Kunjungi Puskesmas atau klinik terdekat untuk pengukuran tensi darah yang akurat oleh tenaga medis sebelum memulai latihan gerak.',
      };
    }
    return {
      actionCode: 'ACTION_VERIFY_MEASUREMENT',
      targetFacility: 'Fasilitas Pelayanan Kesehatan / Posbindu',
      userGuidanceText:
        'Data hasil pengukuran berada di luar batas normal biologis. Lakukan pengukuran ulang menggunakan alat yang terstandarisasi.',
    };
  }

  switch (parameterCode) {
    case 'SYSTOLIC_BLOOD_PRESSURE':
      return {
        actionCode: 'ACTION_ROUTINE_ANNUAL_BP_CHECK',
        targetFacility: 'Posbindu PTM / Puskesmas',
        userGuidanceText:
          'Pemeriksaan tekanan darah Anda perlu diperbarui. Kunjungi Posbindu atau Puskesmas untuk pemeriksaan tensi berkala guna memantau stabilitas hemodinamik vaskular Anda.',
      };

    case 'FASTING_BLOOD_GLUCOSE':
      return {
        actionCode: 'ACTION_PUSKESMAS_GLYCEMIC_SCREENING',
        targetFacility: 'Laboratorium Puskesmas / Faskes Primer',
        userGuidanceText:
          'Pemeriksaan gula darah puasa Anda belum tercatat atau sudah kedaluwarsa. Jadwalkan tes glikemik di Puskesmas untuk mendeteksi dini risiko diabetes yang dapat memengaruhi kesehatan pembuluh darah Anda.',
      };

    case 'BODY_MASS_INDEX':
      return {
        actionCode: 'ACTION_ANTHROPOMETRY_MEASUREMENT',
        targetFacility: 'Posbindu PTM / Pengukuran Mandiri',
        userGuidanceText:
          'Data berat badan dan tinggi badan Anda belum tercatat. Lakukan penimbangan berkala untuk evaluasi status gizi dan indeks massa tubuh.',
      };

    case 'WAIST_CIRCUMFERENCE':
      return {
        actionCode: 'ACTION_POSBINDU_WAIST_MEASUREMENT',
        targetFacility: 'Posbindu PTM / Pengukuran Mandiri',
        userGuidanceText:
          'Ukuran lingkar perut belum pernah dicatat atau telah kedaluwarsa. Lakukan pengukuran mandiri dengan pita ukur atau saat berkunjung ke Posbindu di lingkungan Anda.',
      };

    case 'SMOKING_STATUS_ASSESSMENT':
      return {
        actionCode: 'ACTION_BEHAVIORAL_SMOKING_UPDATE',
        targetFacility: 'Layanan Mandiri / Posbindu PTM',
        userGuidanceText:
          'Pembaruan status riwayat paparan tembakau diperlukan untuk memastikan akurasi estimasi profil risiko kardiovaskular berkala.',
      };

    case 'TOTAL_CHOLESTEROL':
      return {
        actionCode: 'ACTION_ELECTIVE_LIPID_PROFILE_CHECK',
        targetFacility: 'Laboratorium Faskes Primer',
        userGuidanceText:
          'Pemeriksaan profil lipid darah belum pernah tercatat atau telah kedaluwarsa. Konsultasikan dengan dokter faskes untuk pemeriksaan kolesterol terjadwal.',
      };
  }
}

/**
 * Resolves default gap severity based on parameter clinical priority
 */
export function getDefaultSeverity(
  parameterCode: ScreeningParameterCode,
  gapType: GapType
): GapSeverity {
  if (gapType === 'INVALID_DATA') {
    return 'CRITICAL';
  }

  switch (parameterCode) {
    case 'SYSTOLIC_BLOOD_PRESSURE':
    case 'FASTING_BLOOD_GLUCOSE':
      return 'HIGH';
    case 'BODY_MASS_INDEX':
    case 'WAIST_CIRCUMFERENCE':
    case 'TOTAL_CHOLESTEROL':
    case 'SMOKING_STATUS_ASSESSMENT':
      return 'MEDIUM';
  }
}
