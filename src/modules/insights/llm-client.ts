import {
  UpstreamServiceError,
  ValidationError,
} from '../../shared/errors/domain-error.js';

/** Hard SLA: LLM provider must respond within 8 seconds or the call aborts. */
export const DEFAULT_LLM_TIMEOUT_MS = 8000;

export const DEFAULT_LLM_PROVIDER_NAME = 'LLM_PROVIDER';

/**
 * Raw transport contract: sends de-identified prompt payload to the provider
 * and returns the raw completion text. Implementations MUST honor the abort signal.
 */
export type LlmTransport = (
  request: {
    systemPrompt: string;
    userPrompt: string;
    jsonSchema?: unknown;
  },
  signal: AbortSignal
) => Promise<LlmRawResult>;

export interface LlmRawResult {
  rawText: string;
  provider: string;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
}

export interface LlmClientConfig {
  transport?: LlmTransport | undefined;
  timeoutMs?: number | undefined;
  providerName?: string | undefined;
}

/**
 * Resolves the completion timeout from the environment: LLM_TIMEOUT_MS (ms)
 * or AI_TIMEOUT_SECONDS (seconds). Falls back to the 8 s default; invalid
 * values are ignored rather than crashing the engine.
 */
export function resolveTimeoutFromEnv(): number {
  const msRaw = process.env['LLM_TIMEOUT_MS'];
  if (msRaw) {
    const parsed = Number.parseInt(msRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120000) {
      return parsed;
    }
  }
  const secondsRaw = process.env['AI_TIMEOUT_SECONDS'];
  if (secondsRaw) {
    const parsed = Number.parseInt(secondsRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 120) {
      return parsed * 1000;
    }
  }
  return DEFAULT_LLM_TIMEOUT_MS;
}

/**
 * Default HTTP transport for OpenAI-compatible chat completion endpoints.
 * Configuration is read from environment: LLM_API_BASE_URL / LLM_API_KEY /
 * LLM_MODEL, with AI_API_BASE_URL / AI_API_KEY / AI_MODEL as aliases.
 * When no base URL is configured, the transport fails fast so the engine can
 * fail over to the safe deterministic fallback template.
 */
export function createDefaultLlmTransport(
  baseUrl: string = process.env['LLM_API_BASE_URL'] ?? process.env['AI_API_BASE_URL'] ?? '',
  apiKey: string = process.env['LLM_API_KEY'] ?? process.env['AI_API_KEY'] ?? '',
  model: string = process.env['LLM_MODEL'] ?? process.env['AI_MODEL'] ?? 'gpt-4o-mini'
): LlmTransport {
  // Optional reasoning-effort control (LLM_REASONING_EFFORT / AI_REASONING_EFFORT).
  // Some proxies/models reject requests that leave it at the upstream default
  // (e.g. 'minimal'); setting e.g. 'low' fixes those. Only sent when set.
  const reasoningEffort =
    process.env['LLM_REASONING_EFFORT'] ?? process.env['AI_REASONING_EFFORT'] ?? '';

  return async (request, signal) => {
    if (!baseUrl) {
      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_NOT_CONFIGURED',
        detail:
          'Provider LLM belum dikonfigurasi (LLM_API_BASE_URL tidak tersedia).',
      });
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      }),
      signal,
    });

    if (response.status === 429) {
      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_RATE_LIMITED',
        detail: 'Provider LLM menolak permintaan karena batas laju (HTTP 429).',
      });
    }

    if (!response.ok) {
      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_HTTP_FAILURE',
        detail: `Provider LLM merespons dengan status HTTP ${response.status}.`,
      });
    }

    const body: unknown = await response.json();
    const rawText = extractCompletionText(body);

    return {
      rawText,
      provider: DEFAULT_LLM_PROVIDER_NAME,
    };
  };
}

/**
 * Extracts the assistant message content from an OpenAI-compatible response body.
 */
function extractCompletionText(body: unknown): string {
  const candidate = body as
    | { choices?: { message?: { content?: unknown } }[] | undefined }
    | undefined;
  const content = candidate?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.length === 0) {
    throw new UpstreamServiceError({
      serviceName: 'LLM Provider',
      errorCode: 'ERR_LLM_EMPTY_COMPLETION',
      detail: 'Provider LLM tidak mengembalikan konten teks yang dapat diproses.',
    });
  }

  return content;
}

/**
 * Strips markdown code fences and surrounding prose, then parses the JSON object
 * emitted by the LLM. Throws ValidationError when no JSON object can be located.
 */
export function extractJsonContent(rawText: string): Record<string, unknown> {
  const withoutFences = rawText.replace(/```(?:json)?/gi, '');
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new ValidationError({
      detail: 'Keluaran LLM tidak memuat objek JSON yang dapat diparse.',
      errorCode: 'ERR_LLM_NON_JSON_OUTPUT',
    });
  }

  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not-an-object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError({
      detail: 'Keluaran LLM bukan JSON yang valid.',
      errorCode: 'ERR_LLM_MALFORMED_JSON',
    });
  }
}

/**
 * Timeout-guarded LLM client. Every call runs under an AbortController with a
 * hard deadline (default 8 s, configurable via LLM_TIMEOUT_MS or
 * AI_TIMEOUT_SECONDS); transport failures are normalized into RFC 7807
 * UpstreamServiceError so the engine can fail over deterministically.
 */
export class LlmClient {
  private readonly transport: LlmTransport;
  private readonly timeoutMs: number;
  private readonly providerName: string;

  constructor(config?: LlmClientConfig) {
    this.transport = config?.transport ?? createDefaultLlmTransport();
    this.timeoutMs = config?.timeoutMs ?? resolveTimeoutFromEnv();
    this.providerName = config?.providerName ?? DEFAULT_LLM_PROVIDER_NAME;
  }

  /**
   * Executes a single completion call with hard timeout enforcement.
   */
  public async complete(payload: {
    systemPrompt: string;
    userPrompt: string;
    jsonSchema?: unknown;
  }): Promise<LlmRawResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const result = await this.transport(
        {
          systemPrompt: payload.systemPrompt,
          userPrompt: payload.userPrompt,
          jsonSchema: payload.jsonSchema,
        },
        controller.signal
      );

      return {
        rawText: result.rawText,
        provider: result.provider ?? this.providerName,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      };
    } catch (error) {
      if (error instanceof UpstreamServiceError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new UpstreamServiceError({
          serviceName: 'LLM Provider',
          errorCode: 'ERR_LLM_TIMEOUT',
          status: 504,
          detail: `Provider LLM tidak merespons dalam batas waktu ${this.timeoutMs} ms.`,
          cause: error,
        });
      }

      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_UPSTREAM_FAILURE',
        status: 502,
        detail: 'Provider LLM gagal diproses karena kesalahan upstream.',
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
