import crypto from 'node:crypto';
import { ValidationError } from '../../shared/errors/domain-error.js';
import { GenerateHealthInsightRequestSchema } from './validators.js';
import { sanitizeContextForLlm } from './sanitizer.js';
import { buildHealthInsightPrompt } from './prompt-builder.js';
import {
  validateHealthInsightContent,
  validateHealthInsightResponse,
  validateGroundedClinicalContent,
  AI_HEALTH_INSIGHT_JSON_SCHEMA,
} from './validators.js';
import { buildFallbackInsightResponse } from './fallback-templates.js';
import {
  LlmClient,
  extractJsonContent,
  type LlmClientConfig,
} from './llm-client.js';
import type { AiHealthInsightResponse, GenerateHealthInsightRequest } from './types.js';

export interface GenerateHealthInsightOptions {
  llmClient?: LlmClient | undefined;
  llmConfig?: LlmClientConfig | undefined;
  instance?: string | undefined;
  insightId?: string | undefined;
}

/**
 * Validates the raw request against the Zod schema and converts failures into
 * an RFC 7807 ValidationError. Invalid input must NEVER fall back to a template
 * — it must surface as an explicit 4xx contract error.
 */
function parseInsightRequest(
  rawInput: unknown,
  instance: string
): GenerateHealthInsightRequest {
  const result = GenerateHealthInsightRequestSchema.safeParse(rawInput);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error, {
      instance,
      errorCode: 'ERR_INSIGHT_REQUEST_VALIDATION_FAILED',
    });
  }
  return result.data;
}

/**
 * AI Health Insight Engine Orchestrator (MOD-03)
 *
 * Pipeline: input validation -> zero-PII sanitization -> grounded prompt build
 * -> LLM call (8s hard timeout) -> double Zod validation + clinical guardrails
 * -> safe deterministic fallback on ANY provider or schema failure.
 *
 * The fallback path is fully synchronous and executes in < 50 ms.
 */
export async function generateHealthInsight(
  rawInput: unknown,
  options?: GenerateHealthInsightOptions
): Promise<AiHealthInsightResponse> {
  const instance = options?.instance ?? '/api/v1/insights/health';

  // Step 1: Schema validation (outside try — invalid input is a 4xx, not a failover)
  const request = parseInsightRequest(rawInput, instance);

  // Step 2: Zero-PII sanitization and grounded prompt assembly
  const safeContext = sanitizeContextForLlm(request);
  const prompt = buildHealthInsightPrompt(safeContext);

  const client = options?.llmClient ?? new LlmClient(options?.llmConfig);
  const startedAt = performance.now();

  try {
    // Step 3: Call provider under hard 8s AbortController deadline
    const result = await client.complete({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      jsonSchema: AI_HEALTH_INSIGHT_JSON_SCHEMA,
    });

    // Step 4: Zod validation #1 — structured content schema
    const content = validateHealthInsightContent(extractJsonContent(result.rawText));

    // Step 5: Clinical guardrails — anti-hallucination & non-prescriptive veto
    const guardrails = validateGroundedClinicalContent(content, safeContext);
    if (!guardrails.isValid) {
      throw new ValidationError({
        instance,
        errorCode: 'ERR_INSIGHT_GUARDRAIL_VIOLATION',
        detail: `Keluaran LLM melanggar guardrail klinis: ${guardrails.violations
          .map((v) => v.code)
          .join(', ')}`,
      });
    }

    const latencyMs = Math.round(performance.now() - startedAt);

    // Step 6: Zod validation #2 — full response envelope schema
    return validateHealthInsightResponse({
      insightId: options?.insightId ?? `ins-${crypto.randomUUID()}`,
      evaluationId: request.evaluationId,
      generatedAt: new Date().toISOString(),
      modelMeta: {
        provider: result.provider,
        schemaVersion: '1.0.0',
        isFallbackTemplate: false,
        latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      },
      structuredContent: content,
    });
  } catch {
    // Step 7: Safe deterministic failover — instant, grounded, clinically vetted
    const latencyMs = Math.round(performance.now() - startedAt);
    return buildFallbackInsightResponse(safeContext, request.evaluationId, {
      latencyMs,
      insightId: options?.insightId,
    });
  }
}
