/**
 * Types & Domain Definitions for Screening Gap Detection Engine (MOD-02)
 * Standardized against Kemenkes RI / SATUSEHAT 5-Pillar NCD (PTM) Screening Guidelines
 */

export type ScreeningParameterCode =
  | 'SYSTOLIC_BLOOD_PRESSURE'
  | 'BODY_MASS_INDEX'
  | 'WAIST_CIRCUMFERENCE'
  | 'FASTING_BLOOD_GLUCOSE'
  | 'SMOKING_STATUS_ASSESSMENT'
  | 'TOTAL_CHOLESTEROL';

export type GapType =
  | 'MISSING_DATA'
  | 'INVALID_DATA'
  | 'STALE_DATA'
  | 'NEVER_PERFORMED';

export type GapSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type HighestSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type OverallComplianceStatus =
  | 'FULLY_COMPLIANT'
  | 'PARTIALLY_COMPLIANT'
  | 'NON_COMPLIANT'
  | 'ACTION_REQUIRED_CRITICAL';

export interface ActionableRecommendation {
  actionCode: string;
  targetFacility: string;
  userGuidanceText: string;
}

export interface ScreeningGapItem {
  parameterCode: ScreeningParameterCode;
  parameterName: string;
  pillarName: string;
  gapType: GapType;
  severity: GapSeverity;
  daysSinceLastRecorded: number | null;
  validityWindowDays: number;
  recordedValue: number | string | null;
  actionableRecommendation: ActionableRecommendation;
}

export interface ScreeningRecordItem {
  parameterCode: ScreeningParameterCode;
  recordedValue?: number | string | null | undefined;
  unit?: string | null | undefined;
  recordedAt?: string | null | undefined;
}

export interface KnownRiskProfile {
  isKnownHypertensive?: boolean | undefined;
  isKnownDiabetic?: boolean | undefined;
}

export interface ScreeningGapRequest {
  patientId: string;
  evaluationDate?: string | undefined;
  knownRiskProfile?: KnownRiskProfile | undefined;
  screeningRecords: ScreeningRecordItem[];
}

export interface ScreeningGapResponse {
  reportId: string;
  patientId: string;
  evaluationDate: string;
  overallComplianceStatus: OverallComplianceStatus;
  totalParametersEvaluated: number;
  activeGapsCount: number;
  highestSeverity: HighestSeverity;
  identifiedGaps: ScreeningGapItem[];
  clinicalDisclaimer: string;
}
