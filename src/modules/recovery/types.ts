/**
 * Types & Domain Definitions for Recovery Insight Engine (MOD-03B)
 * Weekly tele-rehabilitation recovery evaluation with red-flag triage.
 */

export type RecoveryStatus =
  | 'IMPROVING'
  | 'STABLE'
  | 'DECLINING'
  | 'SAFETY_PAUSE'
  | 'INSUFFICIENT_DATA';

export type SessionCompletionStatus = 'COMPLETED' | 'PARTIAL' | 'SKIPPED';

export type RedFlagCode =
  | 'DIZZINESS_REPORTED'
  | 'CHEST_PAIN_REPORTED'
  | 'DYSPNEA_REPORTED'
  | 'PALPITATION_AT_REST';

export type RedFlagSeverity = 'CRITICAL' | 'HIGH';

export interface RedFlag {
  code: RedFlagCode;
  severity: RedFlagSeverity;
  detectedFrom: string;
  guidance: string;
}

export interface RehabSessionRecord {
  sessionId: string;
  performedAt: string;
  romDegrees: number | null | undefined;
  restingHeartRateBpm: number | null | undefined;
  durationMinutes: number;
  completionStatus: SessionCompletionStatus;
  reportedSymptoms?: string[] | undefined;
}

export interface RecoveryEvaluationRequest {
  patientId: string;
  evaluationDate?: string | undefined;
  prescribedSessionsPerWeek: number;
  currentWeekSessions: RehabSessionRecord[];
  previousWeekSessions?: RehabSessionRecord[] | undefined;
}

export interface RecoveryWeekMetrics {
  observationDays: number;
  completedSessionCount: number;
  totalLoggedSessionCount: number;
  adherencePercent: number;
  currentWeekAvgRomDegrees: number | null;
  previousWeekAvgRomDegrees: number | null;
  deltaRomDegrees: number | null;
  currentWeekAvgBpm: number | null;
  previousWeekAvgBpm: number | null;
  deltaBpm: number | null;
  dataSufficiency: 'SUFFICIENT' | 'INSUFFICIENT';
}

export interface RecoveryNarrativeContent {
  headline: string;
  summaryNarration: string;
  positiveProgressNotes: string[];
  cautionNotes: string[];
  nextWeekGuidance: string[];
  mandatoryDisclaimer: string;
}

export interface RecoveryNarrativeMeta {
  provider: string;
  schemaVersion: string;
  isFallbackTemplate: boolean;
  latencyMs: number;
}

export interface RecoveryEvaluationResponse {
  reportId: string;
  patientId: string;
  evaluationDate: string;
  status: RecoveryStatus;
  metrics: RecoveryWeekMetrics;
  redFlags: RedFlag[];
  narrative: RecoveryNarrativeContent;
  narrativeMeta: RecoveryNarrativeMeta;
  clinicalDisclaimer: string;
}

export interface GeneratedRecoveryPromptPayload {
  systemPrompt: string;
  userPrompt: string;
}
