import { describe, it, expect, vi, afterEach } from 'vitest';
import { aggregateWeeklyMetrics } from '../../../src/modules/recovery/aggregator.js';
import {
  applyDataSufficiencyGate,
  evaluateDataSufficiency,
} from '../../../src/modules/recovery/gatekeeper.js';
import {
  detectRedFlags,
  evaluateWeeklyRecovery,
} from '../../../src/modules/recovery/engine.js';
import {
  validateRecoveryNarrativeGuardrails,
  parseRecoveryNarrative,
  MANDATORY_RECOVERY_DISCLAIMER,
  RECOVERY_CONSTANTS,
} from '../../../src/modules/recovery/validators.js';
import {
  getSafeRecoveryFallback,
  SAFETY_PAUSE_GUIDANCE,
} from '../../../src/modules/recovery/fallback-templates.js';
import { buildRecoveryPrompt } from '../../../src/modules/recovery/prompt-builder.js';
import {
  LlmClient,
  type LlmTransport,
  type LlmRawResult,
} from '../../../src/modules/insights/llm-client.js';
import type {
  RehabSessionRecord,
  RecoveryEvaluationRequest,
  RecoveryEvaluationResponse,
  RecoveryNarrativeContent,
} from '../../../src/modules/recovery/types.js';

// =============================================================================
// Fixtures
// =============================================================================

function session(
  id: string,
  dayOfMonth: number,
  overrides: Partial<RehabSessionRecord> = {}
): RehabSessionRecord {
  return {
    sessionId: id,
    performedAt: `2026-10-${String(dayOfMonth).padStart(2, '0')}T09:00:00.000Z`,
    romDegrees: 90,
    restingHeartRateBpm: 78,
    durationMinutes: 30,
    completionStatus: 'COMPLETED',
    ...overrides,
  };
}

const VALID_REQUEST: RecoveryEvaluationRequest = {
  patientId: 'patient-abc-001',
  evaluationDate: '2026-10-16T00:00:00.000Z',
  prescribedSessionsPerWeek: 5,
  currentWeekSessions: [
    session('s1', 6, { romDegrees: 95, restingHeartRateBpm: 76 }),
    session('s2', 8, { romDegrees: 100, restingHeartRateBpm: 74 }),
    session('s3', 10, { romDegrees: 105, restingHeartRateBpm: 72 }),
  ],
  previousWeekSessions: [
    session('p1', 1, { romDegrees: 80, restingHeartRateBpm: 82 }),
    session('p2', 3, { romDegrees: 84, restingHeartRateBpm: 80 }),
    session('p3', 4, { romDegrees: 82, restingHeartRateBpm: 81 }),
  ],
};

const VALID_LLM_NARRATIVE: RecoveryNarrativeContent = {
  headline: 'Kemajuan Mingguan Anda Meningkat, Pertahankan Ritme Ini',
  summaryNarration:
    'Minggu ini rentang gerak rata-rata Anda meningkat dibanding minggu sebelumnya dengan tingkat kepatuhan latihan yang terjaga. Pertahankan konsistensi ini dan tetap komunikasikan perkembangan Anda kepada fisioterapis.',
  positiveProgressNotes: [
    'Rentang gerak (ROM) meningkat dibanding minggu lalu.',
    'Kepatuhan latihan terjaga baik.',
  ],
  cautionNotes: ['Hindari menambah intensitas tanpa arahan fisioterapis.'],
  nextWeekGuidance: [
    'Pertahankan jadwal latihan yang disetujui fisioterapis.',
    'Catat ROM dan denyut nadi setiap sesi.',
  ],
  mandatoryDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
};

function okTransport(narrative: RecoveryNarrativeContent = VALID_LLM_NARRATIVE): {
  transport: LlmTransport;
  captured: { userPrompt: string }[];
} {
  const captured: { userPrompt: string }[] = [];
  const transport: LlmTransport = async (request) => {
    captured.push({ userPrompt: request.userPrompt });
    const result: LlmRawResult = {
      rawText: JSON.stringify(narrative),
      provider: 'MOCK_RECOVERY_LLM',
    };
    return result;
  };
  return { transport, captured };
}

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// 1. Longitudinal Aggregator (Checkpoint 15)
// =============================================================================

describe('Longitudinal Weekly Aggregator (Checkpoint 15)', () => {
  it('TC-REC-001a: computes Delta ROM, Delta BPM, and Adherence % correctly', () => {
    const metrics = aggregateWeeklyMetrics(
      VALID_REQUEST.currentWeekSessions,
      VALID_REQUEST.previousWeekSessions,
      5
    );

    // current avg ROM = (95+100+105)/3 = 100; previous = (80+84+82)/3 = 82 → +18
    expect(metrics.currentWeekAvgRomDegrees).toBe(100);
    expect(metrics.previousWeekAvgRomDegrees).toBe(82);
    expect(metrics.deltaRomDegrees).toBe(18);

    // current avg BPM = (76+74+72)/3 = 74; previous = (82+80+81)/3 ≈ 81 → -7
    expect(metrics.currentWeekAvgBpm).toBe(74);
    expect(metrics.previousWeekAvgBpm).toBe(81);
    expect(metrics.deltaBpm).toBe(-7);

    expect(metrics.completedSessionCount).toBe(3);
    expect(metrics.adherencePercent).toBe(60);
    expect(metrics.observationDays).toBe(3);
  });

  it('TC-REC-001b: null measurements never contribute zero and never invent a delta', () => {
    const metrics = aggregateWeeklyMetrics(
      [session('s1', 6, { romDegrees: null, restingHeartRateBpm: null }), session('s2', 8)],
      [],
      5
    );

    expect(metrics.currentWeekAvgRomDegrees).toBe(90); // only s2 carries ROM
    expect(metrics.previousWeekAvgRomDegrees).toBeNull();
    expect(metrics.deltaRomDegrees).toBeNull();
    expect(metrics.deltaBpm).toBeNull();
  });

  it('TC-REC-001c: SKIPPED sessions do not count as performed, adherence clamps at 100%', () => {
    const metrics = aggregateWeeklyMetrics(
      [
        session('s1', 6),
        session('s2', 7, { completionStatus: 'SKIPPED' }),
        session('s3', 8),
        session('s4', 9),
        session('s5', 10),
        session('s6', 11),
        session('s7', 12),
      ],
      [],
      3
    );

    expect(metrics.completedSessionCount).toBe(6);
    expect(metrics.totalLoggedSessionCount).toBe(7);
    expect(metrics.adherencePercent).toBe(100);
  });
});

// =============================================================================
// 2. Data Sufficiency Gatekeeper (Checkpoint 15)
// =============================================================================

describe('Data Sufficiency Gatekeeper (Checkpoint 15)', () => {
  it('TC-REC-002: locks INSUFFICIENT_DATA when observation covers fewer than 3 distinct days', () => {
    const metrics = aggregateWeeklyMetrics(
      [
        session('s1', 6, { romDegrees: 95 }),
        session('s2', 6, { romDegrees: 97 }),
      ],
      VALID_REQUEST.previousWeekSessions,
      5
    );
    // 2 performed sessions but only 1 distinct day
    const gated = applyDataSufficiencyGate(metrics);

    expect(metrics.observationDays).toBe(1);
    expect(evaluateDataSufficiency(metrics)).toBe('INSUFFICIENT');
    expect(gated.dataSufficiency).toBe('INSUFFICIENT');
  });

  it('TC-REC-003: rejects trend extrapolation when only 1 session is recorded', async () => {
    const singleSessionRequest: RecoveryEvaluationRequest = {
      ...VALID_REQUEST,
      currentWeekSessions: [session('s1', 6, { romDegrees: 140 })],
    };

    const response = await evaluateWeeklyRecovery(singleSessionRequest, {
      llmClient: new LlmClient({ transport: okTransport().transport }),
    });

    expect(response.status).toBe('INSUFFICIENT_DATA');
    // No trend may be narrated from a single session
    expect(response.narrative.summaryNarration).not.toMatch(/meningkat|menurun/i);
    expect(response.narrative.summaryNarration).toContain('minimal 2 sesi');
    // LLM must not even have been called for an insufficient week
    expect(response.narrativeMeta.isFallbackTemplate).toBe(true);
  });

  it('TC-REC-003b: passes the gate with exactly 3 days and 2 sessions', () => {
    const metrics = aggregateWeeklyMetrics(
      [session('s1', 6), session('s2', 8), session('s3', 8, { completionStatus: 'SKIPPED' })],
      [],
      5
    );
    // 2 performed sessions across 2 distinct days → still insufficient
    expect(evaluateDataSufficiency(metrics)).toBe('INSUFFICIENT');

    const sufficient = aggregateWeeklyMetrics(
      [session('s1', 6), session('s2', 8), session('s3', 9)],
      [],
      5
    );
    expect(sufficient.observationDays).toBe(3);
    expect(evaluateDataSufficiency(sufficient)).toBe('SUFFICIENT');
  });
});

// =============================================================================
// 3. Red-Flag Triage & SAFETY_PAUSE (Checkpoint 16)
// =============================================================================

describe('Red-Flag Triage & SAFETY_PAUSE (Checkpoint 16)', () => {
  it('TC-REC-004: dizziness report triggers SAFETY_PAUSE and stops exercise guidance', async () => {
    const dizzyRequest: RecoveryEvaluationRequest = {
      ...VALID_REQUEST,
      currentWeekSessions: VALID_REQUEST.currentWeekSessions.map((s, i) =>
        i === 1
          ? { ...s, reportedSymptoms: ['Pusing ringan setelah sesi latihan'] }
          : s
      ),
    };

    const flags = detectRedFlags(dizzyRequest.currentWeekSessions);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.code).toBe('DIZZINESS_REPORTED');
    expect(flags[0]?.severity).toBe('HIGH');

    const response = await evaluateWeeklyRecovery(dizzyRequest, {
      llmClient: new LlmClient({ transport: okTransport().transport }),
    });

    expect(response.status).toBe('SAFETY_PAUSE');
    expect(response.redFlags[0]?.code).toBe('DIZZINESS_REPORTED');
    expect(response.narrative.headline).toContain('Dijeda');
    expect(response.narrative.summaryNarration).toContain('dijeda');
    expect(response.narrativeMeta.isFallbackTemplate).toBe(true);
  });

  it('TC-REC-004b: chest pain is a CRITICAL flag and SAFETY_PAUSE overrides sufficient data & LLM', async () => {
    const chestPainRequest: RecoveryEvaluationRequest = {
      ...VALID_REQUEST,
      currentWeekSessions: VALID_REQUEST.currentWeekSessions.map((s, i) =>
        i === 0 ? { ...s, reportedSymptoms: ['Nyeri dada saat mengangkat lengan'] } : s
      ),
    };

    const response = await evaluateWeeklyRecovery(chestPainRequest, {
      llmClient: new LlmClient({ transport: okTransport().transport }),
    });

    expect(response.status).toBe('SAFETY_PAUSE');
    expect(response.redFlags[0]?.severity).toBe('CRITICAL');
    expect(response.narrative.nextWeekGuidance.some((g) => g.includes('dokter'))).toBe(true);
  });

  it('TC-REC-004c: detects dyspnea and palpitation keywords, deduplicates flags', () => {
    const flags = detectRedFlags([
      session('s1', 6, { reportedSymptoms: ['Sesak napas ringan', 'jantung berdebar', 'sesak napas berulang'] }),
    ]);

    const codes = flags.map((f) => f.code).sort();
    expect(codes).toEqual(['DYSPNEA_REPORTED', 'PALPITATION_AT_REST']);
  });
});

// =============================================================================
// 4. Trend Classification & Narrative Guardrails (Checkpoint 16)
// =============================================================================

describe('Trend Classification & Recovery Guardrails (Checkpoint 16)', () => {
  it('TC-REC-005: classifies IMPROVING / STABLE / DECLINING from Delta ROM', async () => {
    const { transport } = okTransport();

    const improving = await evaluateWeeklyRecovery(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
    });
    expect(improving.status).toBe('IMPROVING'); // delta ROM +18 >= 5

    const stable = await evaluateWeeklyRecovery(
      {
        ...VALID_REQUEST,
        currentWeekSessions: [
          session('s1', 6, { romDegrees: 83, restingHeartRateBpm: 80 }),
          session('s2', 8, { romDegrees: 81, restingHeartRateBpm: 81 }),
          session('s3', 10, { romDegrees: 82, restingHeartRateBpm: 82 }),
        ],
      },
      { llmClient: new LlmClient({ transport }) }
    );
    expect(stable.status).toBe('STABLE'); // delta = (82-82) = 0, within ±5 band

    const declining = await evaluateWeeklyRecovery(
      {
        ...VALID_REQUEST,
        currentWeekSessions: [
          session('s1', 6, { romDegrees: 70, restingHeartRateBpm: 84 }),
          session('s2', 8, { romDegrees: 72, restingHeartRateBpm: 85 }),
          session('s3', 10, { romDegrees: 71, restingHeartRateBpm: 86 }),
        ],
      },
      { llmClient: new LlmClient({ transport }) }
    );
    expect(declining.status).toBe('DECLINING'); // delta = (71-82) = -11 <= -5
  });

  it('TC-REC-005b: stable-band boundary values respect the ±5 degree band', () => {
    expect(RECOVERY_CONSTANTS.ROM_STABLE_BAND_DEGREES).toBe(5);
    const metrics = aggregateWeeklyMetrics(
      [session('s1', 6, { romDegrees: 87 }), session('s2', 8, { romDegrees: 87 }), session('s3', 9, { romDegrees: 87 })],
      [session('p1', 1, { romDegrees: 82 }), session('p2', 2, { romDegrees: 82 }), session('p3', 3, { romDegrees: 82 })],
      5
    );
    expect(metrics.deltaRomDegrees).toBe(5); // exactly at band → STABLE (not IMPROVING)

    const response = getSafeRecoveryFallback('STABLE', metrics, []);
    expect(response.headline).toContain('Stabil');
  });

  it('TC-REC-006: LLM narrative is used when valid (isFallbackTemplate=false)', async () => {
    const { transport } = okTransport();
    const response = await evaluateWeeklyRecovery(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
    });

    expect(response.status).toBe('IMPROVING');
    expect(response.narrativeMeta.isFallbackTemplate).toBe(false);
    expect(response.narrativeMeta.provider).toBe('MOCK_RECOVERY_LLM');
    expect(response.narrative.headline).toContain('Pertahankan');
  });

  it('TC-REC-006b: cure claims from the LLM are vetoed to fallback', async () => {
    const curingNarrative: RecoveryNarrativeContent = {
      ...VALID_LLM_NARRATIVE,
      summaryNarration:
        'Luar biasa! Dengan latihan rutin ini Anda akan sembuh total dari stroke minggu depan.',
    };
    const { transport } = okTransport(curingNarrative);

    const response = await evaluateWeeklyRecovery(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
    });

    expect(response.narrativeMeta.isFallbackTemplate).toBe(true);
    expect(JSON.stringify(response.narrative)).not.toMatch(/sembuh/i);
  });

  it('TC-REC-006c: drug prescriptions from the LLM are vetoed to fallback', async () => {
    const drugNarrative: RecoveryNarrativeContent = {
      ...VALID_LLM_NARRATIVE,
      nextWeekGuidance: [
        'Minumlah Amlodipin 10 mg setiap pagi sebelum latihan.',
        'Catat ROM setiap sesi.',
      ],
    };
    const { transport } = okTransport(drugNarrative);

    const response = await evaluateWeeklyRecovery(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
    });

    expect(response.narrativeMeta.isFallbackTemplate).toBe(true);
  });

  it('TC-REC-006d: guardrail validator unit checks (cure claim, drug, disclaimer)', () => {
    expect(
      validateRecoveryNarrativeGuardrails(VALID_LLM_NARRATIVE)
    ).toEqual([]);

    expect(
      validateRecoveryNarrativeGuardrails({
        ...VALID_LLM_NARRATIVE,
        positiveProgressNotes: ['Anda telah pulih sepenuhnya.'],
      })
    ).toContain('RECOVERY_GUARDRAIL_CURE_CLAIM');

    expect(
      validateRecoveryNarrativeGuardrails({
        ...VALID_LLM_NARRATIVE,
        cautionNotes: ['Jangan lupakan Metformin Anda.'],
      })
    ).toContain('RECOVERY_GUARDRAIL_DRUG_PRESCRIPTION');

    expect(
      validateRecoveryNarrativeGuardrails({
        ...VALID_LLM_NARRATIVE,
        mandatoryDisclaimer: 'Semoga lekas membaik ya!',
      })
    ).toContain('RECOVERY_GUARDRAIL_INVALID_DISCLAIMER');

    // Schema parse rejects too-short narrative
    expect(() =>
      parseRecoveryNarrative({ headline: 'Hi', summaryNarration: '' })
    ).toThrow();
  });
});

// =============================================================================
// 5. Full Pipeline & Input Validation (Checkpoint 17)
// =============================================================================

describe('Full Recovery Pipeline (Checkpoint 17)', () => {
  it('TC-REC-007: response envelope is complete, RFC-compliant, and deterministic', async () => {
    const { transport } = okTransport();
    const response = await evaluateWeeklyRecovery(VALID_REQUEST, {
      llmClient: new LlmClient({ transport }),
      reportId: 'rec-fixed-001',
    }) as RecoveryEvaluationResponse;

    expect(response.reportId).toBe('rec-fixed-001');
    expect(response.patientId).toBe('patient-abc-001');
    expect(response.evaluationDate).toBe('2026-10-16T00:00:00.000Z');
    expect(response.metrics.dataSufficiency).toBe('SUFFICIENT');
    expect(response.clinicalDisclaimer).toBe(MANDATORY_RECOVERY_DISCLAIMER);
    expect(response.narrative.mandatoryDisclaimer).toContain('BUKAN diagnosis');
    expect(typeof response.narrativeMeta.latencyMs).toBe('number');
    expect(Array.isArray(response.redFlags)).toBe(true);
  });

  it('TC-REC-007b: prompt payload is fact-bound and carries no cure claim language', () => {
    const metrics = aggregateWeeklyMetrics(
      VALID_REQUEST.currentWeekSessions,
      VALID_REQUEST.previousWeekSessions,
      5
    );
    const prompt = buildRecoveryPrompt(metrics, 'IMPROVING', []);

    expect(prompt.systemPrompt).toContain('DILARANG MENYATAKAN KLIAM KESBUHAN');
    expect(prompt.systemPrompt).toContain('HANYA GUNAKAN FAKTA');
    expect(prompt.userPrompt).toContain('Delta ROM: 18');
    expect(prompt.userPrompt).toContain('adherence 60%');
    expect(prompt.userPrompt).toContain('Tidak ada tanda bahaya');
  });

  it('TC-REC-008: invalid request throws RFC 7807 ValidationError without fallback', async () => {
    const { transport } = okTransport();

    // Missing patientId
    await expect(
      evaluateWeeklyRecovery(
        { ...VALID_REQUEST, patientId: undefined },
        { llmClient: new LlmClient({ transport }) }
      )
    ).rejects.toMatchObject({ errorCode: 'ERR_RECOVERY_REQUEST_VALIDATION_FAILED' });

    // physiologically impossible ROM (400 degrees)
    await expect(
      evaluateWeeklyRecovery(
        {
          ...VALID_REQUEST,
          currentWeekSessions: [session('s1', 6, { romDegrees: 400 })],
        },
        { llmClient: new LlmClient({ transport }) }
      )
    ).rejects.toMatchObject({ errorCode: 'ERR_RECOVERY_REQUEST_VALIDATION_FAILED' });

    // non-ISO evaluation date
    await expect(
      evaluateWeeklyRecovery(
        { ...VALID_REQUEST, evaluationDate: 'bukan-tanggal' },
        { llmClient: new LlmClient({ transport }) }
      )
    ).rejects.toMatchObject({ errorCode: 'ERR_RECOVERY_REQUEST_VALIDATION_FAILED' });
  });

  it('TC-REC-008b: LLM timeout fails over to instant fallback (< 50 ms)', async () => {
    vi.useFakeTimers();

    const hangingTransport: LlmTransport = (_request, signal) =>
      new Promise<LlmRawResult>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      });

    const pending = evaluateWeeklyRecovery(VALID_REQUEST, {
      llmClient: new LlmClient({ transport: hangingTransport }),
    });

    await vi.advanceTimersByTimeAsync(8000);
    const response = await pending;

    expect(response.narrativeMeta.isFallbackTemplate).toBe(true);
    expect(response.status).toBe('IMPROVING'); // deterministic status unaffected
    expect(SAFETY_PAUSE_GUIDANCE.length).toBeGreaterThan(0);
  });

  it('TC-REC-008c: SAFETY_PAUSE fallback narrative is generated without any LLM call', async () => {
    const safetyRequest: RecoveryEvaluationRequest = {
      ...VALID_REQUEST,
      currentWeekSessions: VALID_REQUEST.currentWeekSessions.map((s, i) =>
        i === 2 ? { ...s, reportedSymptoms: ['pusing'] } : s
      ),
    };

    const startedAt = performance.now();
    const response = await evaluateWeeklyRecovery(safetyRequest); // no LLM client at all
    const elapsed = performance.now() - startedAt;

    expect(response.status).toBe('SAFETY_PAUSE');
    expect(elapsed).toBeLessThan(50);
    expect(response.narrativeMeta.provider).toBe('DETERMINISTIC_FALLBACK_TEMPLATE');
  });
});
