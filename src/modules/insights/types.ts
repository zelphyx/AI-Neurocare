import type {
  Gender,
  WhoRiskCategory,
  WhoRiskLevel,
} from '../screening/types.js';

export type AgeGroup = '40_TO_44' | '45_TO_49' | '50_TO_54' | '55_TO_59';

export type ActionPlanCategory =
  | 'MEDICAL_FOLLOWUP'
  | 'LIFESTYLE_MODIFICATION'
  | 'MONITORING_ROUTINE';

export type ActionPlanUrgency =
  | 'START_IMMEDIATELY'
  | 'RECOMMENDED_WITHIN_14_DAYS'
  | 'ROUTINE_MONTHLY';

export interface ActionPlanItem {
  category: ActionPlanCategory;
  actionText: string;
  urgency: ActionPlanUrgency;
}

export interface AiHealthInsightContent {
  headline: string;
  summaryNarration: string;
  primaryRiskDrivers: string[];
  actionPlan: ActionPlanItem[];
  rehabilitationPreparationNote: string;
  mandatoryDisclaimer: string;
}

/**
 * Anonymized, zero-PII clinical context sent to LLM provider
 */
export interface SafePatientLlmContext {
  ageGroup: AgeGroup;
  gender: Gender;
  systolicBloodPressureMmHg: number;
  resolvedBmi: number;
  isCurrentSmoker: boolean;
  riskCategory: WhoRiskCategory;
  riskLevel: WhoRiskLevel;
  isHypertensiveCrisis: boolean;
  hasActiveGaps: boolean;
  identifiedGapsSummary: string[];
  preferredLanguage: 'id_ID';
}

export interface GenerateHealthInsightRequest {
  evaluationId: string;
  patientAgeYears: number;
  gender: Gender;
  systolicBloodPressureMmHg: number;
  resolvedBmi: number;
  isCurrentSmoker: boolean;
  riskCategory: WhoRiskCategory;
  riskLevel: WhoRiskLevel;
  isHypertensiveCrisis: boolean;
  identifiedGapsSummary?: string[] | undefined;
  preferredLanguage?: 'id_ID' | undefined;
}

export interface ModelMeta {
  provider: string;
  schemaVersion: string;
  isFallbackTemplate: boolean;
  latencyMs: number;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
}

export interface AiHealthInsightResponse {
  insightId: string;
  evaluationId: string;
  generatedAt: string;
  modelMeta: ModelMeta;
  structuredContent: AiHealthInsightContent;
}

export interface GuardrailViolation {
  code: string;
  message: string;
  matchedText?: string | undefined;
}

export interface GuardrailValidationResult {
  isValid: boolean;
  violations: GuardrailViolation[];
}

export interface GeneratedPromptPayload {
  systemPrompt: string;
  userPrompt: string;
}
