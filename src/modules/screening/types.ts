/**
 * Types & Domain Definitions for Clinical Screening Engine (MOD-01)
 * Adheres to WHO Cardiovascular Disease Risk Charts (South-East Asia Region / SEAR)
 * Reference: Lancet Global Health 2019; 7: e1332-45
 */

export type Gender = 'MALE' | 'FEMALE';
export type SmokerStatus = 'SMOKER' | 'NON_SMOKER';
export type DiabetesStatus = 'DIABETIC' | 'NON_DIABETIC';

export type WhoRiskCategory =
  | 'UNDER_5_PERCENT'
  | '5_TO_UNDER_10_PERCENT'
  | '10_TO_UNDER_20_PERCENT'
  | '20_TO_UNDER_30_PERCENT'
  | '30_PERCENT_AND_ABOVE';

export type WhoRiskLevel =
  | 'LOW_RISK'
  | 'MODERATE_RISK'
  | 'HIGH_RISK'
  | 'VERY_HIGH_RISK';

export type WhoChartType = 'SEAR_NON_LAB' | 'SEAR_LAB';

// Discretized Bins for WHO Table Lookup
export type AgeBin =
  | 'BIN_AGE_40_44'
  | 'BIN_AGE_45_49'
  | 'BIN_AGE_50_54'
  | 'BIN_AGE_55_59';

export type SbpBin =
  | 'BIN_SBP_UNDER_120'
  | 'BIN_SBP_120_139'
  | 'BIN_SBP_140_159'
  | 'BIN_SBP_160_179'
  | 'BIN_SBP_180_ABOVE';

export type BmiBin =
  | 'BIN_BMI_UNDER_20'
  | 'BIN_BMI_20_TO_24'
  | 'BIN_BMI_25_TO_29'
  | 'BIN_BMI_30_TO_34'
  | 'BIN_BMI_35_ABOVE';

export type CholesterolBin =
  | 'BIN_CHOL_UNDER_4'
  | 'BIN_CHOL_4_TO_4_9'
  | 'BIN_CHOL_5_TO_5_9'
  | 'BIN_CHOL_6_TO_6_9'
  | 'BIN_CHOL_7_ABOVE';

/**
 * 5-Dimensional Deterministic Lookup Matrix for WHO SEAR Non-Laboratory Model
 * Dimensions: [Gender][SmokerStatus][AgeBin][SbpBin][BmiBin] -> WhoRiskCategory
 */
export type WhoNonLabMatrix = Record<
  Gender,
  Record<
    SmokerStatus,
    Record<
      AgeBin,
      Record<
        SbpBin,
        Record<BmiBin, WhoRiskCategory>
      >
    >
  >
>;

/**
 * 6-Dimensional Deterministic Lookup Matrix for WHO SEAR Laboratory Model
 * Dimensions: [Gender][SmokerStatus][DiabetesStatus][AgeBin][SbpBin][CholesterolBin] -> WhoRiskCategory
 */
export type WhoLabMatrix = Record<
  Gender,
  Record<
    SmokerStatus,
    Record<
      DiabetesStatus,
      Record<
        AgeBin,
        Record<
          SbpBin,
          Record<CholesterolBin, WhoRiskCategory>
        >
      >
    >
  >
>;

export interface BinBreakdown {
  ageBin: AgeBin;
  sbpBin: SbpBin;
  bmiBin: BmiBin | null;
  cholesterolBin: CholesterolBin | null;
}

export interface ScreeningEvaluationRequest {
  patientAgeYears: number;
  gender: Gender;
  isCurrentSmoker: boolean;
  systolicBloodPressureMmHg: number;
  bodyMassIndex?: number | null | undefined;
  weightKg?: number | null | undefined;
  heightCm?: number | null | undefined;
  totalCholesterolMmolL?: number | null | undefined;
  hasDiabetes?: boolean | null | undefined;
}

export interface ScreeningEvaluationResponse {
  evaluationId: string;
  patientAgeYears: number;
  gender: Gender;
  isCurrentSmoker: boolean;
  systolicBloodPressureMmHg: number;
  resolvedBmi: number;
  riskScoreCategory: WhoRiskCategory;
  riskLevel: WhoRiskLevel;
  chartTypeUsed: WhoChartType;
  binBreakdown: BinBreakdown;
  isHypertensiveCrisis: boolean;
  calculatedAt: string;
  clinicalDisclaimer: string;
}
