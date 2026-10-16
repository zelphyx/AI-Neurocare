import crypto from 'node:crypto';
import { LlmClient, extractJsonContent, type LlmClientConfig } from '../insights/llm-client.js';
import { validateRecoveryEvaluationRequest } from './validators.js';
import { aggregateWeeklyMetrics } from './aggregator.js';
import { applyDataSufficiencyGate, evaluateDataSufficiency } from './gatekeeper.js';
import { buildRecoveryPrompt } from './prompt-builder.js';
import { parseRecoveryNarrative, validateRecoveryNarrativeGuardrails } from './validators.js';
import { getSafeRecoveryFallback } from './fallback-templates.js';
import { MANDATORY_RECOVERY_DISCLAIMER } from './validators.js';
import { RECOVERY_CONSTANTS } from './validators.js';
import type {
  RehabSessionRecord,
  RecoveryStatus,
  RecoveryEvaluationResponse,
  RecoveryNarrativeContent,
  RedFlag,
  RedFlagCode,
} from './types.js';

export interface EvaluateRecoveryOptions {
  llmClient?: LlmClient | undefined;
  llmConfig?: LlmClientConfig | undefined;
  instance?: string | undefined;
  reportId?: string | undefined;
}

interface SymptomRule {
  code: RedFlagCode;
  severity: 'CRITICAL' | 'HIGH';
  patterns: RegExp[];
  guidance: string;
}

const SYMPTOM_RULES: SymptomRule[] = [
  {
    code: 'CHEST_PAIN_REPORTED',
    severity: 'CRITICAL',
    patterns: [
      /nyeri\s+dada/i,
      /sakit\s+dada/i,
      /chest\s+pain/i,
      /dada\s+(?:terasa\s+)?(?:remas|ditusuk|berat)\b/i,
    ],
    guidance: 'Segera ke IGD atau hubungi dokter bila nyeri dada berlanjut.',
  },
  {
    code: 'DIZZINESS_REPORTED',
    severity: 'HIGH',
    patterns: [
      /\bpusing\b/i,
      /vertigo/i,
      /kepala\s+berputar/i,
      /\bdizzy\b/i,
      /mata\s+(?:berkedip\s+)?layu/i,
    ],
    guidance: 'Hentikan latihan, duduk tenang, dan laporkan ke fisioterapis.',
  },
  {
    code: 'DYSPNEA_REPORTED',
    severity: 'HIGH',
    patterns: [
      /sesak\s+napas/i,
      /susah\s+napas/i,
      /napas\s+pendek/i,
      /shortness\s+of\s+breath/i,
    ],
    guidance: 'Istirahatkan diri dan evaluasikan ke tenaga medis sebelum latihan berikutnya.',
  },
  {
    code: 'PALPITATION_AT_REST',
    severity: 'HIGH',
    patterns: [
      /\b(?:jantung\s+)?berdebar\b/i,
      /palpitasi/i,
      /\bpalpitation/i,
    ],
    guidance: 'Catat denyut nadi dan konsultasikan keluhan berdebar ke dokter.',
  },
];

/**
 * Red-Flag Triage (MOD-03B)
 * Scans self-reported symptoms across the week's sessions for danger signs
 * (dizziness, chest pain, dyspnea, palpitations). Any match forces SAFETY_PAUSE.
 */
export function detectRedFlags(
  sessions: RehabSessionRecord[]
): RedFlag[] {
  const redFlags: RedFlag[] = [];

  for (const session of sessions) {
    for (const symptom of session.reportedSymptoms ?? []) {
      for (const rule of SYMPTOM_RULES) {
        const matched = rule.patterns.find((p) => p.test(symptom));
        if (matched && !redFlags.some((f) => f.code === rule.code)) {
          redFlags.push({
            code: rule.code,
            severity: rule.severity,
            detectedFrom: `sesi ${session.sessionId}`,
            guidance: rule.guidance,
          });
        }
      }
    }
  }

  return redFlags;
}

/**
 * Deterministic trend classification from week-over-week Delta ROM.
 * Requires a previous-week baseline; without one no trend may be claimed (STABLE).
 */
function classifyTrendStatus(deltaRomDegrees: number | null): RecoveryStatus {
  if (deltaRomDegrees === null) {
    return 'STABLE';
  }
  if (deltaRomDegrees >= RECOVERY_CONSTANTS.ROM_STABLE_BAND_DEGREES) {
    return 'IMPROVING';
  }
  if (deltaRomDegrees <= -RECOVERY_CONSTANTS.ROM_STABLE_BAND_DEGREES) {
    return 'DECLINING';
  }
  return 'STABLE';
}

/**
 * Recovery Insight Engine Orchestrator (MOD-03B)
 *
 * Pipeline: input validation -> weekly aggregation -> red-flag triage
 * -> data sufficiency gate -> status resolution -> narrative generation
 * (LLM with guardrails for trend statuses, deterministic fallback for
 * SAFETY_PAUSE / INSUFFICIENT_DATA / provider failures).
 */
export async function evaluateWeeklyRecovery(
  rawInput: unknown,
  options?: EvaluateRecoveryOptions
): Promise<RecoveryEvaluationResponse> {
  const instance = options?.instance ?? '/api/v1/recovery/insight';

  // Step 1: Validate request schema
  const request = validateRecoveryEvaluationRequest(rawInput, instance);

  // Step 2: Aggregate longitudinal weekly metrics
  const metrics = applyDataSufficiencyGate(
    aggregateWeeklyMetrics(
      request.currentWeekSessions,
      request.previousWeekSessions ?? [],
      request.prescribedSessionsPerWeek
    )
  );

  // Step 3: Red-flag triage — symptoms ALWAYS override everything else
  const redFlags = detectRedFlags(request.currentWeekSessions);

  let status: RecoveryStatus;
  if (redFlags.length > 0) {
    status = 'SAFETY_PAUSE';
  } else if (evaluateDataSufficiency(metrics) === 'INSUFFICIENT') {
    status = 'INSUFFICIENT_DATA';
  } else {
    status = classifyTrendStatus(metrics.deltaRomDegrees);
  }

  // Step 4: Narrative — safety/insufficiency statuses never go to the LLM
  let narrative: RecoveryNarrativeContent;
  let provider: string;
  let isFallback: boolean;
  let latencyMs: number;

  if (status === 'SAFETY_PAUSE' || status === 'INSUFFICIENT_DATA') {
    narrative = getSafeRecoveryFallback(status, metrics, redFlags);
    provider = 'DETERMINISTIC_FALLBACK_TEMPLATE';
    isFallback = true;
    latencyMs = 0;
  } else {
    const client = options?.llmClient ?? new LlmClient(options?.llmConfig);
    const prompt = buildRecoveryPrompt(metrics, status, redFlags);
    const startedAt = performance.now();

    try {
      const result = await client.complete({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
      });

      const candidate = parseRecoveryNarrative(extractJsonContent(result.rawText));
      const violations = validateRecoveryNarrativeGuardrails(candidate);
      if (violations.length > 0) {
        throw new Error(`guardrail:${violations.join(',')}`);
      }

      narrative = candidate;
      provider = result.provider;
      isFallback = false;
      latencyMs = Math.round(performance.now() - startedAt);
    } catch {
      narrative = getSafeRecoveryFallback(status, metrics, redFlags);
      provider = 'DETERMINISTIC_FALLBACK_TEMPLATE';
      isFallback = true;
      latencyMs = Math.round(performance.now() - startedAt);
    }
  }

  return {
    reportId: options?.reportId ?? `rec-${crypto.randomUUID()}`,
    patientId: request.patientId,
    evaluationDate: request.evaluationDate
      ? new Date(request.evaluationDate).toISOString()
      : new Date().toISOString(),
    status,
    metrics,
    redFlags,
    narrative,
    narrativeMeta: {
      provider,
      schemaVersion: '1.0.0',
      isFallbackTemplate: isFallback,
      latencyMs,
    },
    clinicalDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
  };
}
