import { describe, it, expect } from 'vitest';
import {
  mapAgeToAgeGroup,
  sanitizeContextForLlm,
} from '../../../src/modules/insights/sanitizer.js';
import {
  SYSTEM_PROMPT_TEMPLATE,
  getBmiCategoryLabel,
  buildUserContextMessage,
  buildHealthInsightPrompt,
} from '../../../src/modules/insights/prompt-builder.js';
import {
  AI_HEALTH_INSIGHT_JSON_SCHEMA,
  ActionPlanItemSchema,
  AiHealthInsightContentSchema,
  AiHealthInsightResponseSchema,
  GenerateHealthInsightRequestSchema,
  validateGroundedClinicalContent,
  validateHealthInsightContent,
  validateHealthInsightResponse,
  assertClinicalGuardrails,
} from '../../../src/modules/insights/validators.js';
import {
  INSIGHT_MANDATORY_DISCLAIMER,
  getSafeDeterministicFallback,
  buildFallbackInsightResponse,
} from '../../../src/modules/insights/fallback-templates.js';
import { ClinicalValidationError } from '../../../src/shared/errors/domain-error.js';
import type {
  SafePatientLlmContext,
  AiHealthInsightContent,
  GenerateHealthInsightRequest,
} from '../../../src/modules/insights/types.js';

describe('AI Health Insight Schema, Prompt & Guardrails (MOD-03 Checkpoint 11)', () => {
  const mockSafeContext: SafePatientLlmContext = {
    ageGroup: '50_TO_54',
    gender: 'MALE',
    systolicBloodPressureMmHg: 150,
    resolvedBmi: 27.2,
    isCurrentSmoker: true,
    riskCategory: '10_TO_UNDER_20_PERCENT',
    riskLevel: 'MODERATE_RISK',
    isHypertensiveCrisis: false,
    hasActiveGaps: true,
    identifiedGapsSummary: [
      'Gula Darah Puasa (Data kedaluwarsa, terakhir diperiksa 601 hari yang lalu)',
      'Kolesterol Serum Total (Belum pernah diperiksa seumur hidup)',
    ],
    preferredLanguage: 'id_ID',
  };

  const mockValidContent: AiHealthInsightContent = {
    headline:
      'Kesehatan Jantung dan Pembuluh Darah Anda Berada pada Tingkat Risiko Sedang',
    summaryNarration:
      'Berdasarkan hasil evaluasi skrining kesehatan, profil risiko kardiovaskular 10 tahun Anda berada pada kategori Sedang (10% hingga di bawah 20%). Artinya, terdapat peluang terjadinya gangguan vaskular yang dapat dicegah secara signifikan jika Anda memulai perubahan gaya hidup sehat mulai hari ini.',
    primaryRiskDrivers: [
      'Tekanan darah sistolik berada pada angka 150 mmHg (melebihi batas optimal 120 mmHg).',
      'Kebiasaan merokok aktif yang mempercepat kekakuan dinding pembuluh darah arteri.',
      'Berat badan berlebih (BMI 27.2 kg/m²) yang memberikan beban kerja ekstra pada jantung.',
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
          'Kurangi asupan garam harian hingga maksimal 1 sendok teh per hari dan konsultasikan langkah bertahap berhenti merokok.',
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

  // =========================================================================
  // 1. PII Sanitization & De-Identification Tests
  // =========================================================================
  describe('1. PII Sanitization & Cohort Mapping (sanitizer.ts)', () => {
    it('should map ages 40-59 into standard 5-year cohorts', () => {
      expect(mapAgeToAgeGroup(40)).toBe('40_TO_44');
      expect(mapAgeToAgeGroup(44)).toBe('40_TO_44');
      expect(mapAgeToAgeGroup(45)).toBe('45_TO_49');
      expect(mapAgeToAgeGroup(49)).toBe('45_TO_49');
      expect(mapAgeToAgeGroup(50)).toBe('50_TO_54');
      expect(mapAgeToAgeGroup(54)).toBe('50_TO_54');
      expect(mapAgeToAgeGroup(55)).toBe('55_TO_59');
      expect(mapAgeToAgeGroup(59)).toBe('55_TO_59');
    });

    it('should throw ClinicalValidationError when age is outside 40-59 population model', () => {
      expect(() => mapAgeToAgeGroup(39)).toThrow(ClinicalValidationError);
      expect(() => mapAgeToAgeGroup(60)).toThrow(ClinicalValidationError);

      try {
        mapAgeToAgeGroup(35);
      } catch (err) {
        expect(err).toBeInstanceOf(ClinicalValidationError);
        const ce = err as ClinicalValidationError;
        expect(ce.errorCode).toBe('ERR_AGE_OUT_OF_STUDY_RANGE');
      }
    });

    it('should sanitize input request and eliminate 100% PII', () => {
      // Injected with potential PII from gateway
      const rawInjectedRequest: GenerateHealthInsightRequest & {
        patientName?: string;
        nik?: string;
        phoneNumber?: string;
        email?: string;
        address?: string;
        dateOfBirth?: string;
      } = {
        evaluationId: 'eval-uuid-12345',
        patientAgeYears: 52,
        gender: 'MALE',
        systolicBloodPressureMmHg: 145,
        resolvedBmi: 26.857,
        isCurrentSmoker: true,
        riskCategory: '10_TO_UNDER_20_PERCENT',
        riskLevel: 'MODERATE_RISK',
        isHypertensiveCrisis: false,
        identifiedGapsSummary: ['  Gula Darah Puasa Stale  ', ''],
        preferredLanguage: 'id_ID',
        patientName: 'Budi Santoso',
        nik: '3171012345670001',
        phoneNumber: '+6281234567890',
        email: 'budi@example.com',
        address: 'Jl. Merdeka No. 10 Jakarta',
        dateOfBirth: '1974-05-12',
      };

      const safe = sanitizeContextForLlm(rawInjectedRequest);

      // Verify no PII fields exist on sanitized context
      expect((safe as Record<string, unknown>).patientName).toBeUndefined();
      expect((safe as Record<string, unknown>).nik).toBeUndefined();
      expect((safe as Record<string, unknown>).phoneNumber).toBeUndefined();
      expect((safe as Record<string, unknown>).email).toBeUndefined();
      expect((safe as Record<string, unknown>).address).toBeUndefined();
      expect((safe as Record<string, unknown>).dateOfBirth).toBeUndefined();

      // Verify generalized cohort & rounded metrics
      expect(safe.ageGroup).toBe('50_TO_54');
      expect(safe.resolvedBmi).toBe(26.86);
      expect(safe.hasActiveGaps).toBe(true);
      expect(safe.identifiedGapsSummary).toEqual(['Gula Darah Puasa Stale']);
      expect(safe.preferredLanguage).toBe('id_ID');
    });

    it('should handle request with empty or missing gaps gracefully', () => {
      const request: GenerateHealthInsightRequest = {
        evaluationId: 'eval-123',
        patientAgeYears: 42,
        gender: 'FEMALE',
        systolicBloodPressureMmHg: 118,
        resolvedBmi: 21.5,
        isCurrentSmoker: false,
        riskCategory: 'UNDER_5_PERCENT',
        riskLevel: 'LOW_RISK',
        isHypertensiveCrisis: false,
      };

      const safe = sanitizeContextForLlm(request);
      expect(safe.ageGroup).toBe('40_TO_44');
      expect(safe.hasActiveGaps).toBe(false);
      expect(safe.identifiedGapsSummary).toEqual([]);
      expect(safe.preferredLanguage).toBe('id_ID');
    });

    it('should handle non-array raw gaps gracefully', () => {
      const requestWithNonArrayGaps: GenerateHealthInsightRequest = {
        evaluationId: 'eval-123',
        patientAgeYears: 45,
        gender: 'MALE',
        systolicBloodPressureMmHg: 125,
        resolvedBmi: 23.0,
        isCurrentSmoker: false,
        riskCategory: 'UNDER_5_PERCENT',
        riskLevel: 'LOW_RISK',
        isHypertensiveCrisis: false,
        identifiedGapsSummary: 'not-an-array' as unknown as string[],
      };

      const safe = sanitizeContextForLlm(requestWithNonArrayGaps);
      expect(safe.hasActiveGaps).toBe(false);
      expect(safe.identifiedGapsSummary).toEqual([]);
    });
  });

  // =========================================================================
  // 2. Prompt Builder & Negative Constraints Tests
  // =========================================================================
  describe('2. Prompt Construction & Guardrails (prompt-builder.ts)', () => {
    it('should include all 7 mandatory clinical safety rules in the system prompt', () => {
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('ANDA BUKAN DOKTER DIAGNOSTIK');
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('DILARANG MERESEPKAN OBAT');
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('PRINSIP GROUNDEDNESS');
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('PENANGANAN DATA KOSONG');
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('PENANGANAN KRISIS HIPERTENSI');
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('FORMAT OUTPUT');
      expect(SYSTEM_PROMPT_TEMPLATE).toContain('BAHASA');
    });

    it('should categorize BMI qualitatively in user message', () => {
      expect(getBmiCategoryLabel(17.5)).toBe('Berat Badan Kurang');
      expect(getBmiCategoryLabel(21.0)).toBe('Berat Badan Normal');
      expect(getBmiCategoryLabel(24.5)).toBe('Kelebihan Berat Badan');
      expect(getBmiCategoryLabel(27.0)).toBe('Obesitas');
    });

    it('should construct user message with full de-identified context and active gaps', () => {
      const userMessage = buildUserContextMessage(mockSafeContext);

      expect(userMessage).toContain('Kelompok Usia: 50_TO_54 tahun');
      expect(userMessage).toContain('Jenis Kelamin: Laki-Laki (MALE)');
      expect(userMessage).toContain('Tekanan Darah Sistolik: 150 mmHg');
      expect(userMessage).toContain('Indeks Massa Tubuh (BMI): 27.2 kg/m² (Kategori: Obesitas)');
      expect(userMessage).toContain('Status Merokok: Merokok Aktif (SMOKER)');
      expect(userMessage).toContain(
        'Kategori Risiko Kardiovaskular 10 Tahun WHO: 10_TO_UNDER_20_PERCENT (MODERATE_RISK)'
      );
      expect(userMessage).toContain('Status Krisis Hipertensi: false');
      expect(userMessage).toContain('Gula Darah Puasa');
      expect(userMessage).toContain('Kolesterol Serum Total');
    });

    it('should highlight crisis warning in user message when isHypertensiveCrisis is true', () => {
      const crisisContext: SafePatientLlmContext = {
        ...mockSafeContext,
        systolicBloodPressureMmHg: 185,
        isHypertensiveCrisis: true,
      };

      const userMessage = buildUserContextMessage(crisisContext);
      expect(userMessage).toContain('PERINGATAN KRISIS MEDIS: Tekanan Darah Sistolik >= 180 mmHg');
    });

    it('should format female gender correctly in user message', () => {
      const femaleContext: SafePatientLlmContext = {
        ...mockSafeContext,
        gender: 'FEMALE',
      };

      const userMessage = buildUserContextMessage(femaleContext);
      expect(userMessage).toContain('Jenis Kelamin: Perempuan (FEMALE)');
    });

    it('should display no-gaps indicator when patient has no active screening gaps', () => {
      const completeContext: SafePatientLlmContext = {
        ...mockSafeContext,
        isCurrentSmoker: false,
        hasActiveGaps: false,
        identifiedGapsSummary: [],
      };

      const userMessage = buildUserContextMessage(completeContext);
      expect(userMessage).toContain('Tidak ada kesenjangan data klinis aktif');
      expect(userMessage).toContain('Status Merokok: Tidak Merokok (NON_SMOKER)');
    });

    it('should generate complete prompt payload without leaking any PII', () => {
      const payload = buildHealthInsightPrompt(mockSafeContext);

      expect(payload.systemPrompt).toBe(SYSTEM_PROMPT_TEMPLATE);
      expect(payload.userPrompt).toContain('50_TO_54');

      // Zero PII leakage verification
      expect(payload.userPrompt).not.toMatch(/\b(Budi|Santoso|NIK|0812|Jakarta)\b/i);
    });
  });

  // =========================================================================
  // 3. Schema & Guardrail Validation Tests
  // =========================================================================
  describe('3. JSON Schema & Anti-Hallucination Guardrails (validators.ts)', () => {
    it('should define a valid JSON Schema Draft 2020-12 structure', () => {
      expect(AI_HEALTH_INSIGHT_JSON_SCHEMA.$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema'
      );
      expect(AI_HEALTH_INSIGHT_JSON_SCHEMA.required).toEqual([
        'headline',
        'summaryNarration',
        'primaryRiskDrivers',
        'actionPlan',
        'rehabilitationPreparationNote',
        'mandatoryDisclaimer',
      ]);
    });

    it('should validate compliant structured content with Zod', () => {
      const validated = validateHealthInsightContent(mockValidContent);
      expect(validated.headline).toBe(mockValidContent.headline);
      expect(validated.actionPlan).toHaveLength(3);
    });

    it('should reject content violating actionPlan length bounds', () => {
      const tooFewActions = {
        ...mockValidContent,
        actionPlan: [
          {
            category: 'LIFESTYLE_MODIFICATION',
            actionText: 'Kurangi konsumsi garam harian.',
            urgency: 'START_IMMEDIATELY',
          },
        ],
      };

      expect(() => validateHealthInsightContent(tooFewActions)).toThrow(
        ClinicalValidationError
      );
    });

    it('should reject content violating primaryRiskDrivers length bounds', () => {
      const noDrivers = {
        ...mockValidContent,
        primaryRiskDrivers: [],
      };

      expect(() => validateHealthInsightContent(noDrivers)).toThrow(
        ClinicalValidationError
      );
    });

    it('should reject content when mandatoryDisclaimer is missing or too short', () => {
      const emptyDisclaimer = {
        ...mockValidContent,
        mandatoryDisclaimer: '',
      };

      expect(() => validateHealthInsightContent(emptyDisclaimer)).toThrow(
        ClinicalValidationError
      );
    });

    it('should validate full response payload including model metadata', () => {
      const fullResponse = {
        insightId: 'ins-uuid-12345',
        evaluationId: 'eval-uuid-67890',
        generatedAt: '2026-10-16T10:00:00.000Z',
        modelMeta: {
          provider: 'OPENAI_GPT_4O_MINI',
          schemaVersion: '1.0.0',
          isFallbackTemplate: false,
          latencyMs: 1450,
          promptTokens: 420,
          completionTokens: 310,
        },
        structuredContent: mockValidContent,
      };

      const parsed = validateHealthInsightResponse(fullResponse);
      expect(parsed.insightId).toBe('ins-uuid-12345');
      expect(parsed.modelMeta.latencyMs).toBe(1450);
    });

    it('should reject invalid response payload with ClinicalValidationError', () => {
      expect(() =>
        validateHealthInsightResponse({ invalidPayload: true })
      ).toThrow(ClinicalValidationError);
    });

    // Guardrail interceptors
    it('should pass clinical guardrails for completely safe content', () => {
      const result = validateGroundedClinicalContent(
        mockValidContent,
        mockSafeContext
      );
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);

      expect(() =>
        assertClinicalGuardrails(mockValidContent, mockSafeContext)
      ).not.toThrow();
    });

    it('should intercept prohibited diagnostic declarative statements', () => {
      const contentWithDiagnosis: AiHealthInsightContent = {
        ...mockValidContent,
        summaryNarration:
          'Berdasarkan hasil skrining, Anda menderita hipertensi derajat dua dan vonis medis ini memerlukan terapi.',
      };

      const result = validateGroundedClinicalContent(
        contentWithDiagnosis,
        mockSafeContext
      );
      expect(result.isValid).toBe(false);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_PROHIBITED_DIAGNOSTIC_CLAIM'
        )
      ).toBe(true);

      expect(() =>
        assertClinicalGuardrails(contentWithDiagnosis, mockSafeContext)
      ).toThrow(ClinicalValidationError);
    });

    it('should intercept prohibited prescription drug names and dosages', () => {
      const contentWithDrugs: AiHealthInsightContent = {
        ...mockValidContent,
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

      const result = validateGroundedClinicalContent(
        contentWithDrugs,
        mockSafeContext
      );
      expect(result.isValid).toBe(false);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_PROHIBITED_DRUG_PRESCRIPTION'
        )
      ).toBe(true);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_PROHIBITED_DOSING_INSTRUCTION'
        )
      ).toBe(true);
    });

    it('should enforce START_IMMEDIATELY and emergency facility mention in hypertensive crisis', () => {
      const crisisContext: SafePatientLlmContext = {
        ...mockSafeContext,
        systolicBloodPressureMmHg: 188,
        isHypertensiveCrisis: true,
      };

      // Missing START_IMMEDIATELY and missing IGD/Puskesmas
      const relaxedContentInCrisis: AiHealthInsightContent = {
        ...mockValidContent,
        actionPlan: [
          {
            category: 'MEDICAL_FOLLOWUP',
            actionText: 'Jadwalkan kunjungan santai bulan depan.',
            urgency: 'ROUTINE_MONTHLY',
          },
          {
            category: 'LIFESTYLE_MODIFICATION',
            actionText: 'Kurangi garam.',
            urgency: 'RECOMMENDED_WITHIN_14_DAYS',
          },
        ],
      };

      const result = validateGroundedClinicalContent(
        relaxedContentInCrisis,
        crisisContext
      );
      expect(result.isValid).toBe(false);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_CRISIS_URGENCY_MISSING'
        )
      ).toBe(true);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_CRISIS_EMERGENCY_FACILITY_MISSING'
        )
      ).toBe(true);
    });

    it('should intercept hallucinated assertions on unmeasured screening gaps', () => {
      const contentAssertingGaps: AiHealthInsightContent = {
        ...mockValidContent,
        summaryNarration:
          'Meskipun data belum lengkap, gula darah Anda normal dan aman dari risiko metabolik.',
      };

      const result = validateGroundedClinicalContent(
        contentAssertingGaps,
        mockSafeContext
      );
      expect(result.isValid).toBe(false);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_UNMEASURED_PARAMETER_ASSERTION'
        )
      ).toBe(true);
    });

    it('should reject content with inadequate or empty disclaimer', () => {
      const badDisclaimer: AiHealthInsightContent = {
        ...mockValidContent,
        mandatoryDisclaimer: 'Ini hanyalah ringkasan singkat.',
      };

      const result = validateGroundedClinicalContent(
        badDisclaimer,
        mockSafeContext
      );
      expect(result.isValid).toBe(false);
      expect(
        result.violations.some(
          (v) => v.code === 'GUARDRAIL_INVALID_MANDATORY_DISCLAIMER'
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // 4. Safe Deterministic Fallback Template Tests
  // =========================================================================
  describe('4. Deterministic Fallback Templates (fallback-templates.ts)', () => {
    it('should generate valid fallback content for LOW_RISK profile', () => {
      const lowRiskContext: SafePatientLlmContext = {
        ...mockSafeContext,
        systolicBloodPressureMmHg: 115,
        resolvedBmi: 21.0,
        isCurrentSmoker: false,
        riskCategory: 'UNDER_5_PERCENT',
        riskLevel: 'LOW_RISK',
        hasActiveGaps: false,
        identifiedGapsSummary: [],
      };

      const fallback = getSafeDeterministicFallback(lowRiskContext);

      expect(fallback.headline).toContain('Rendah');
      expect(fallback.summaryNarration).toContain('Rendah');
      expect(fallback.primaryRiskDrivers).toHaveLength(2);
      expect(fallback.actionPlan.length).toBeGreaterThanOrEqual(2);
      expect(fallback.mandatoryDisclaimer).toBe(INSIGHT_MANDATORY_DISCLAIMER);

      // Verify schema & guardrail pass 100%
      expect(validateHealthInsightContent(fallback)).toBeDefined();
      expect(
        validateGroundedClinicalContent(fallback, lowRiskContext).isValid
      ).toBe(true);
    });

    it('should generate valid fallback content for HIGH_RISK profile with active gaps', () => {
      const highRiskContext: SafePatientLlmContext = {
        ...mockSafeContext,
        systolicBloodPressureMmHg: 165,
        riskCategory: '20_TO_UNDER_30_PERCENT',
        riskLevel: 'HIGH_RISK',
        hasActiveGaps: true,
      };

      const fallback = getSafeDeterministicFallback(highRiskContext);

      expect(fallback.headline).toContain('Tinggi');
      expect(
        fallback.actionPlan.some((item) => item.actionText.includes('Puskesmas'))
      ).toBe(true);
      expect(
        fallback.actionPlan.some((item) => item.actionText.includes('14 hari'))
      ).toBe(true);

      expect(validateHealthInsightContent(fallback)).toBeDefined();
      expect(
        validateGroundedClinicalContent(fallback, highRiskContext).isValid
      ).toBe(true);
    });

    it('should generate urgent emergency fallback content for hypertensive crisis', () => {
      const crisisContext: SafePatientLlmContext = {
        ...mockSafeContext,
        systolicBloodPressureMmHg: 190,
        isHypertensiveCrisis: true,
      };

      const fallback = getSafeDeterministicFallback(crisisContext);

      expect(fallback.headline).toContain('PERINGATAN KLINIS');
      expect(fallback.summaryNarration).toContain('krisis hipertensi');
      expect(fallback.summaryNarration).toContain('IGD');

      const immediateActions = fallback.actionPlan.filter(
        (item) => item.urgency === 'START_IMMEDIATELY'
      );
      expect(immediateActions.length).toBeGreaterThanOrEqual(1);
      expect(immediateActions[0]?.actionText).toMatch(/(?:IGD|Puskesmas|darurat)/i);

      expect(fallback.rehabilitationPreparationNote).toContain('Tunda semua aktivitas');

      // Guardrail validation must pass 100%
      expect(validateHealthInsightContent(fallback)).toBeDefined();
      const guardrail = validateGroundedClinicalContent(fallback, crisisContext);
      expect(guardrail.isValid).toBe(true);
    });

    it('should generate fallback content for hypertensive crisis with non-smoker', () => {
      const nonSmokerCrisis: SafePatientLlmContext = {
        ...mockSafeContext,
        systolicBloodPressureMmHg: 195,
        isCurrentSmoker: false,
        isHypertensiveCrisis: true,
      };

      const fallback = getSafeDeterministicFallback(nonSmokerCrisis);
      expect(fallback.primaryRiskDrivers[1]).toContain('Indeks massa tubuh dan profil vaskular');
      expect(validateHealthInsightContent(fallback)).toBeDefined();
    });

    it('should generate fallback content for VERY_HIGH_RISK with no gaps', () => {
      const veryHighNoGaps: SafePatientLlmContext = {
        ...mockSafeContext,
        riskLevel: 'VERY_HIGH_RISK',
        riskCategory: '30_PERCENT_AND_ABOVE',
        hasActiveGaps: false,
        identifiedGapsSummary: [],
      };

      const fallback = getSafeDeterministicFallback(veryHighNoGaps);
      expect(fallback.headline).toContain('Sangat Tinggi');
      expect(fallback.summaryNarration).toContain('Sangat Tinggi');
      expect(
        fallback.actionPlan.some(
          (a) => a.category === 'MEDICAL_FOLLOWUP' && a.urgency === 'RECOMMENDED_WITHIN_14_DAYS'
        )
      ).toBe(true);
    });

    it('should wrap fallback content into a complete AiHealthInsightResponse', () => {
      const response = buildFallbackInsightResponse(
        mockSafeContext,
        'eval-test-999',
        {
          provider: 'MOCK_FALLBACK_TEST',
          latencyMs: 12,
        }
      );

      expect(response.evaluationId).toBe('eval-test-999');
      expect(response.modelMeta.isFallbackTemplate).toBe(true);
      expect(response.modelMeta.provider).toBe('MOCK_FALLBACK_TEST');
      expect(response.modelMeta.latencyMs).toBe(12);
      expect(response.structuredContent.headline).toContain('Sedang');

      // Validate against complete response schema
      const parsed = validateHealthInsightResponse(response);
      expect(parsed.modelMeta.isFallbackTemplate).toBe(true);
    });
  });

  // =========================================================================
  // 5. GenerateHealthInsightRequestSchema Tests
  // =========================================================================
  describe('5. Input Request Zod Validation (GenerateHealthInsightRequestSchema)', () => {
    it('should successfully parse valid generation request', () => {
      const rawRequest = {
        evaluationId: 'eval-1234',
        patientAgeYears: 50,
        gender: 'MALE',
        systolicBloodPressureMmHg: 130,
        resolvedBmi: 24.5,
        isCurrentSmoker: false,
        riskCategory: '5_TO_UNDER_10_PERCENT',
        riskLevel: 'LOW_RISK',
        isHypertensiveCrisis: false,
        identifiedGapsSummary: ['Kolesterol Total Stale'],
        preferredLanguage: 'id_ID',
      };

      const parsed = GenerateHealthInsightRequestSchema.parse(rawRequest);
      expect(parsed.evaluationId).toBe('eval-1234');
      expect(parsed.patientAgeYears).toBe(50);
    });

    it('should reject request with out-of-range patient age', () => {
      const invalidRequest = {
        evaluationId: 'eval-1234',
        patientAgeYears: 65, // Out of 40..59 range
        gender: 'FEMALE',
        systolicBloodPressureMmHg: 120,
        resolvedBmi: 22.0,
        isCurrentSmoker: false,
        riskCategory: 'UNDER_5_PERCENT',
        riskLevel: 'LOW_RISK',
        isHypertensiveCrisis: false,
      };

      expect(() =>
        GenerateHealthInsightRequestSchema.parse(invalidRequest)
      ).toThrow();
    });
  });
});
