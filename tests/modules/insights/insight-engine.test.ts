import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LlmClient,
  DEFAULT_LLM_TIMEOUT_MS,
  extractJsonContent,
  type LlmTransport,
  type LlmRawResult,
} from '../../../src/modules/insights/llm-client.js';
import {
  generateHealthInsight,
} from '../../../src/modules/insights/engine.js';
import {
  validateHealthInsightResponse,
} from '../../../src/modules/insights/validators.js';
import { UpstreamServiceError } from '../../../src/shared/errors/domain-error.js';
import type { AiHealthInsightContent } from '../../../src/modules/insights/types.js';

// =============================================================================
// Fixtures
// =============================================================================

const VALID_REQUEST = {
  evaluationId: 'eval-insight-001',
  patientAgeYears: 52,
  gender: 'MALE',
  systolicBloodPressureMmHg: 150,
  resolvedBmi: 27.2,
  isCurrentSmoker: true,
  riskCategory: '10_TO_UNDER_20_PERCENT',
  riskLevel: 'MODERATE_RISK',
  isHypertensiveCrisis: false,
  identifiedGapsSummary: [
    'Gula Darah Puasa (Data kedaluwarsa, terakhir diperiksa 601 hari yang lalu)',
  ],
  preferredLanguage: 'id_ID',
} as const;

const VALID_LLM_CONTENT: AiHealthInsightContent = {
  headline:
    'Kesehatan Jantung dan Pembuluh Darah Anda Berada pada Tingkat Risiko Sedang',
  summaryNarration:
    'Berdasarkan hasil evaluasi skrining kesehatan, profil risiko kardiovaskular 10 tahun Anda berada pada kategori Sedang. Terdapat peluang gangguan vaskular yang dapat dicegah secara signifikan jika Anda memulai perubahan gaya hidup sehat mulai hari ini.',
  primaryRiskDrivers: [
    'Tekanan darah sistolik berada pada angka 150 mmHg (melebihi batas optimal 120 mmHg).',
    'Kebiasaan merokok aktif yang mempercepat kekakuan dinding pembuluh darah arteri.',
  ],
  actionPlan: [
    {
      category: 'MEDICAL_FOLLOWUP',
      actionText:
        'Kunjungi Puskesmas terdekat dalam kurun waktu 14 hari untuk pemeriksaan ulang tekanan darah dan melengkapi pemeriksaan gula darah yang telah kedaluwarsa.',
      urgency: 'RECOMMENDED_WITHIN_14_DAYS',
    },
    {
      category: 'LIFESTYLE_MODIFICATION',
      actionText:
        'Kurangi asupan garam harian hingga maksimal satu sendok teh per hari dan konsultasikan langkah bertahap berhenti merokok.',
      urgency: 'START_IMMEDIATELY',
    },
    {
      category: 'MONITORING_ROUTINE',
      actionText:
        'Lakukan pemantauan laju denyut nadi secara berkala menggunakan fitur Camera PPG sebelum beristirahat.',
      urgency: 'ROUTINE_MONTHLY',
    },
  ],
  rehabilitationPreparationNote:
    'Sebelum melakukan latihan gerak fisik mandiri, pastikan Anda dalam kondisi bugar, tidak merasa pusing, dan tidak mengalami nyeri dada.',
  mandatoryDisclaimer:
    'Wawasan ini disusun oleh asisten cerdas berbasis data skrining Anda dan BUKAN diagnosis medis resmi pengganti konsultasi langsung dengan dokter.',
};

function okTransport(content: AiHealthInsightContent = VALID_LLM_CONTENT): {
  transport: LlmTransport;
  captured: { systemPrompt: string; userPrompt: string }[];
} {
  const captured: { systemPrompt: string; userPrompt: string }[] = [];
  const transport: LlmTransport = async (request) => {
    captured.push({ systemPrompt: request.systemPrompt, userPrompt: request.userPrompt });
    const result: LlmRawResult = {
      rawText: JSON.stringify(content),
      provider: 'MOCK_LLM_PROVIDER',
      promptTokens: 420,
      completionTokens: 310,
    };
    return result;
  };
  return { transport, captured };
}

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Unit Tests: LlmClient (Checkpoint 13)
// =============================================================================

describe('LlmClient — AbortController Timeout 8s (Checkpoint 13)', () => {
  it('resolves with raw LLM output when provider responds in time', async () => {
    const { transport } = okTransport();
    const client = new LlmClient({ transport, providerName: 'MOCK_LLM_PROVIDER' });

    const result = await client.complete({ systemPrompt: 'SYS', userPrompt: 'USR' });

    expect(result.rawText).toContain('Kesehatan Jantung');
    expect(result.provider).toBe('MOCK_LLM_PROVIDER');
    expect(result.promptTokens).toBe(420);
  });

  it(`aborts the request via AbortController after ${DEFAULT_LLM_TIMEOUT_MS} ms and throws UpstreamServiceError 504`, async () => {
    vi.useFakeTimers();

    const hangingTransport: LlmTransport = (_request, signal) =>
      new Promise<LlmRawResult>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true }
        );
      });

    const client = new LlmClient({ transport: hangingTransport });

    const pending = client.complete({ systemPrompt: 'SYS', userPrompt: 'USR' });
    const assertion = expect(pending).rejects.toMatchObject({
      errorCode: 'ERR_LLM_TIMEOUT',
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_LLM_TIMEOUT_MS);
    await assertion;
  });

  it('does not abort an in-flight successful call (timer cleared on completion)', async () => {
    vi.useFakeTimers();
    const { transport } = okTransport();
    const client = new LlmClient({ transport });

    const pending = client.complete({ systemPrompt: 'SYS', userPrompt: 'USR' });
    const assertion = expect(pending).resolves.toMatchObject({
      provider: 'MOCK_LLM_PROVIDER',
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_LLM_TIMEOUT_MS * 10);
    await assertion;
  });

  it('normalizes unknown transport failures into UpstreamServiceError 502', async () => {
    const failingTransport: LlmTransport = async () => {
      throw new Error('ECONNRESET');
    };
    const client = new LlmClient({ transport: failingTransport });

    await expect(
      client.complete({ systemPrompt: 'SYS', userPrompt: 'USR' })
    ).rejects.toMatchObject({
      errorCode: 'ERR_LLM_UPSTREAM_FAILURE',
      status: 502,
    });
  });
});

describe('extractJsonContent — markdown fence & noise stripping', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonContent('{"headline":"abc"}')).toEqual({ headline: 'abc' });
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const fenced = 'Berikut hasilnya:\n```json\n' + JSON.stringify(VALID_LLM_CONTENT) + '\n```';
    expect(extractJsonContent(fenced)).toEqual(VALID_LLM_CONTENT);
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJsonContent('Maaf, saya tidak dapat menjawab.')).toThrow();
  });
});

// =============================================================================
// Full Engine Tests (Checkpoint 14 — TC-INSIGHT-001 s.d. TC-INSIGHT-008)
// =============================================================================

describe('AI Health Insight Engine (MOD-03 Checkpoint 14)', () => {
  it('TC-INSIGHT-001: generates structured insight from successful LLM response (isFallbackTemplate=false)', async () => {
    const { transport } = okTransport();
    const response = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport, providerName: 'MOCK_LLM_PROVIDER' }),
      insightId: 'ins-fixed-001',
    });

    expect(response.insightId).toBe('ins-fixed-001');
    expect(response.evaluationId).toBe('eval-insight-001');
    expect(response.modelMeta.isFallbackTemplate).toBe(false);
    expect(response.modelMeta.provider).toBe('MOCK_LLM_PROVIDER');
    expect(response.modelMeta.promptTokens).toBe(420);
    expect(response.modelMeta.completionTokens).toBe(310);
    expect(response.structuredContent.headline).toContain('Risiko Sedang');

    // Full RFC-compliant response must pass the complete Zod schema
    expect(() => validateHealthInsightResponse(response)).not.toThrow();
  });

  it('TC-INSIGHT-002: guarantees 100% zero PII on the transit payload sent to the LLM provider', async () => {
    const { transport, captured } = okTransport();
    const rawRequestWithPii = {
      ...VALID_REQUEST,
      patientName: 'Budi Santoso',
      nik: '3171012345670001',
      phoneNumber: '+6281234567890',
      email: 'budi@example.com',
      address: 'Jl. Merdeka No. 10 Jakarta',
      dateOfBirth: '1974-05-12',
    };

    await generateHealthInsight(rawRequestWithPii, {
      llmClient: new LlmClient({ transport }),
    });

    expect(captured).toHaveLength(1);
    const transit = JSON.stringify(captured[0]);
    expect(transit).not.toMatch(/Budi|Santoso/i);
    expect(transit).not.toContain('3171012345670001');
    expect(transit).not.toContain('+6281234567890');
    expect(transit).not.toContain('budi@example.com');
    expect(transit).not.toContain('Jl. Merdeka');
    expect(transit).not.toContain('1974-05-12');
  });

  it('TC-INSIGHT-003: fails over to safe deterministic fallback when LLM times out after 8s', async () => {
    vi.useFakeTimers();

    const hangingTransport: LlmTransport = (_request, signal) =>
      new Promise<LlmRawResult>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true }
        );
      });

    const pending = generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport: hangingTransport }),
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_LLM_TIMEOUT_MS);
    const response = await pending;

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
    expect(response.modelMeta.provider).toBe('DETERMINISTIC_FALLBACK_TEMPLATE');
    expect(response.structuredContent.mandatoryDisclaimer).toContain('BUKAN diagnosis');
  });

  it('TC-INSIGHT-004: fails over to fallback template on HTTP 429 rate limiting', async () => {
    const rateLimitedTransport: LlmTransport = async () => {
      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_RATE_LIMITED',
        status: 502,
        detail: 'Provider LLM menolak permintaan karena batas laju (HTTP 429).',
      });
    };

    const response = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport: rateLimitedTransport }),
    });

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
    expect(response.evaluationId).toBe('eval-insight-001');
    expect(response.structuredContent.actionPlan.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-INSIGHT-005: fails over to fallback when LLM output violates the Zod schema', async () => {
    const malformedContent = {
      ...VALID_LLM_CONTENT,
      headline: 'Hi', // violates min(5)
      actionPlan: 'bukan-array' as unknown as AiHealthInsightContent['actionPlan'],
    };
    const { transport } = okTransport(malformedContent);

    const response = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
    });

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
    expect(response.structuredContent.summaryNarration.length).toBeGreaterThan(20);
  });

  it('TC-INSIGHT-005b: fails over to fallback when LLM emits non-JSON prose', async () => {
    const proseTransport: LlmTransport = async () => ({
      rawText: 'Maaf, saya tidak dapat memproses permintaan Anda saat ini.',
      provider: 'MOCK_LLM_PROVIDER',
    });

    const response = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport: proseTransport }),
    });

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
  });

  it('TC-INSIGHT-006: fails over to fallback when LLM output breaches clinical guardrails (drug prescription)', async () => {
    const unsafeContent: AiHealthInsightContent = {
      ...VALID_LLM_CONTENT,
      actionPlan: [
        {
          category: 'MEDICAL_FOLLOWUP',
          actionText: 'Minumlah Amlodipin 10 mg setiap pagi secara teratur.',
          urgency: 'START_IMMEDIATELY',
        },
        {
          category: 'LIFESTYLE_MODIFICATION',
          actionText: 'Konsumsi juga Aspilet dan Metformin sesuai anjuran.',
          urgency: 'RECOMMENDED_WITHIN_14_DAYS',
        },
      ],
    };
    const { transport } = okTransport(unsafeContent);

    const response = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
    });

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
    // The fallback must itself be free of the prohibited drug names
    const responseText = JSON.stringify(response.structuredContent);
    expect(responseText).not.toMatch(/amlodipin|aspilet|metformin/i);
  });

  it('TC-INSIGHT-007: delivers urgent emergency redirection for hypertensive crisis (SBP >= 180)', async () => {
    const crisisRequest = {
      ...VALID_REQUEST,
      systolicBloodPressureMmHg: 185,
      riskCategory: '30_PERCENT_AND_ABOVE',
      riskLevel: 'VERY_HIGH_RISK',
      isHypertensiveCrisis: true,
    };

    // (a) Fallback path — crisis content must be urgent
    const failingTransport: LlmTransport = async () => {
      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_UPSTREAM_FAILURE',
        detail: 'Provider down.',
      });
    };
    const fallbackResponse = await generateHealthInsight(crisisRequest, {
      llmClient: new LlmClient({ transport: failingTransport }),
    });

    expect(fallbackResponse.modelMeta.isFallbackTemplate).toBe(true);
    expect(fallbackResponse.structuredContent.headline).toContain('PERINGATAN KLINIS');
    expect(fallbackResponse.structuredContent.summaryNarration).toContain('IGD');
    expect(
      fallbackResponse.structuredContent.actionPlan.some(
        (item) => item.urgency === 'START_IMMEDIATELY'
      )
    ).toBe(true);

    // (b) LLM path — crisis response must still pass guardrails (requires START_IMMEDIATELY)
    const crisisContent: AiHealthInsightContent = {
      ...VALID_LLM_CONTENT,
      headline: 'Tekanan Darah Anda Sangat Tinggi dan Memerlukan Pemeriksaan Segera',
      actionPlan: [
        {
          category: 'MEDICAL_FOLLOWUP',
          actionText:
            'Segera periksakan diri ke IGD atau Puskesmas terdekat hari ini untuk evaluasi tekanan darah darurat.',
          urgency: 'START_IMMEDIATELY',
        },
        {
          category: 'MONITORING_ROUTINE',
          actionText:
            'Duduk tenang, hindari aktivitas fisik berat, dan minta pendampingan keluarga hingga mendapat pertolongan medis.',
          urgency: 'START_IMMEDIATELY',
        },
      ],
    };
    const { transport } = okTransport(crisisContent);
    const llmResponse = await generateHealthInsight(crisisRequest, {
      llmClient: new LlmClient({ transport }),
    });

    expect(llmResponse.modelMeta.isFallbackTemplate).toBe(false);
    expect(
      llmResponse.structuredContent.actionPlan.some(
        (item) => item.urgency === 'START_IMMEDIATELY'
      )
    ).toBe(true);
  });

  it('TC-INSIGHT-008: performs zero disease inference from missing screening data (groundedness)', async () => {
    // (a) A hallucinating LLM claiming normal values for unmeasured parameters gets vetoed
    const hallucinatingContent: AiHealthInsightContent = {
      ...VALID_LLM_CONTENT,
      summaryNarration:
        'Meskipun pemeriksaan belum dilakukan, gula darah Anda normal dan aman dari risiko metabolik.',
    };
    const { transport: hallucinatingTransport } = okTransport(hallucinatingContent);
    const vetoed = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport: hallucinatingTransport }),
    });
    expect(vetoed.modelMeta.isFallbackTemplate).toBe(true);

    // (b) The fallback itself never infers disease from empty data
    const fallbackText = JSON.stringify(vetoed.structuredContent);
    expect(fallbackText).not.toMatch(
      /\b(?:anda|pasien)\s+(?:menderita|mengidap|terdiagnosa|divonis)\b/i
    );
    expect(vetoed.structuredContent.mandatoryDisclaimer).toContain('BUKAN diagnosis');
  });

  it('rejects invalid input with RFC 7807 ClinicalValidationError BEFORE calling the LLM (no fallback for bad input)', async () => {
    const { transport } = okTransport();
    const invalidRequest = {
      ...VALID_REQUEST,
      patientAgeYears: 35, // outside 40-59 population model
    };

    await expect(
      generateHealthInsight(invalidRequest, {
        llmClient: new LlmClient({ transport }),
      })
    ).rejects.toMatchObject({
      errorCode: 'ERR_INSIGHT_REQUEST_VALIDATION_FAILED',
      status: 400,
    });
  });

  it('fails over to instant fallback when no LLM provider is configured (default transport)', async () => {
    const response = await generateHealthInsight(VALID_REQUEST);

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
    expect(response.evaluationId).toBe('eval-insight-001');
  });
});

// =============================================================================
// Performance SLA (Checkpoint 13: fallback < 50 ms)
// =============================================================================

describe('Performance SLA — Safe Deterministic Fallback < 50 ms', () => {
  it('returns fallback insight in under 50 ms when provider fails instantly', async () => {
    const failingTransport: LlmTransport = async () => {
      throw new UpstreamServiceError({
        serviceName: 'LLM Provider',
        errorCode: 'ERR_LLM_UPSTREAM_FAILURE',
        detail: 'Connection refused.',
      });
    };

    const startedAt = performance.now();
    const response = await generateHealthInsight(VALID_REQUEST, {
      llmClient: new LlmClient({ transport: failingTransport }),
    });
    const elapsedMs = performance.now() - startedAt;

    expect(response.modelMeta.isFallbackTemplate).toBe(true);
    expect(elapsedMs).toBeLessThan(50);

    console.log(
      `[Benchmark SLA] MOD-03 failover latency: ${elapsedMs.toFixed(3)} ms (target < 50 ms)`
    );
  });
});
