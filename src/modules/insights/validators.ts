import { z } from 'zod';
import { ClinicalValidationError } from '../../shared/errors/domain-error.js';
import type {
  AiHealthInsightContent,
  AiHealthInsightResponse,
  SafePatientLlmContext,
  GuardrailValidationResult,
  GuardrailViolation,
} from './types.js';

/**
 * Formal JSON Schema (Draft 2020-12) fed to OpenAI / Gemini Structured Outputs
 */
export const AI_HEALTH_INSIGHT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.ai-neurocare.org/v1/AiHealthInsightResponse.json',
  title: 'AiHealthInsightResponse',
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description:
        'Judul ringkasan wawasan utama yang empatik dan menarik perhatian (maksimal 120 karakter).',
    },
    summaryNarration: {
      type: 'string',
      description:
        'Penjelasan naratif ramah pasien mengenai makna tingkat risiko kardiovaskular 10 tahun mereka (2-3 paragraf ringkas).',
    },
    primaryRiskDrivers: {
      type: 'array',
      items: {
        type: 'string',
      },
      minItems: 1,
      maxItems: 4,
      description:
        'Daftar faktor risiko utama pasien yang bersumber murni dari data terukur (misal: tensi tinggi, rokok).',
    },
    actionPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [
              'MEDICAL_FOLLOWUP',
              'LIFESTYLE_MODIFICATION',
              'MONITORING_ROUTINE',
            ],
          },
          actionText: {
            type: 'string',
            description: 'Langkah konkret yang harus dilakukan pasien.',
          },
          urgency: {
            type: 'string',
            enum: [
              'START_IMMEDIATELY',
              'RECOMMENDED_WITHIN_14_DAYS',
              'ROUTINE_MONTHLY',
            ],
          },
        },
        required: ['category', 'actionText', 'urgency'],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 5,
      description:
        'Daftar rencana tindakan terstruktur yang dapat ditindaklanjuti secara mandiri atau di faskes.',
    },
    rehabilitationPreparationNote: {
      type: 'string',
      description:
        'Petunjuk persiapan dan batasan kehati-hatian sebelum memulai pemantauan vital dan latihan gerak mandiri.',
    },
    mandatoryDisclaimer: {
      type: 'string',
      description:
        'Kalimat penafian medis resmi wajib yang menegaskan bahwa wawasan ini bukan diagnosis dokter.',
    },
  },
  required: [
    'headline',
    'summaryNarration',
    'primaryRiskDrivers',
    'actionPlan',
    'rehabilitationPreparationNote',
    'mandatoryDisclaimer',
  ],
  additionalProperties: false,
} as const;

export const ActionPlanCategorySchema = z.enum([
  'MEDICAL_FOLLOWUP',
  'LIFESTYLE_MODIFICATION',
  'MONITORING_ROUTINE',
]);

export const ActionPlanUrgencySchema = z.enum([
  'START_IMMEDIATELY',
  'RECOMMENDED_WITHIN_14_DAYS',
  'ROUTINE_MONTHLY',
]);

export const ActionPlanItemSchema = z.object({
  category: ActionPlanCategorySchema,
  actionText: z.string().trim().min(5).max(300),
  urgency: ActionPlanUrgencySchema,
});

export const AiHealthInsightContentSchema = z.object({
  headline: z.string().trim().min(5).max(200),
  summaryNarration: z.string().trim().min(20).max(2500),
  primaryRiskDrivers: z.array(z.string().trim().min(3)).min(1).max(4),
  actionPlan: z.array(ActionPlanItemSchema).min(2).max(5),
  rehabilitationPreparationNote: z.string().trim().min(5).max(600),
  mandatoryDisclaimer: z.string().trim().min(10).max(600),
});

export const ModelMetaSchema = z.object({
  provider: z.string().min(1),
  schemaVersion: z.string().min(1),
  isFallbackTemplate: z.boolean(),
  latencyMs: z.number().nonnegative(),
  promptTokens: z.number().nonnegative().optional(),
  completionTokens: z.number().nonnegative().optional(),
});

export const AiHealthInsightResponseSchema = z.object({
  insightId: z.string().min(1),
  evaluationId: z.string().min(1),
  generatedAt: z.string().min(1),
  modelMeta: ModelMetaSchema,
  structuredContent: AiHealthInsightContentSchema,
});

export const GenerateHealthInsightRequestSchema = z.object({
  evaluationId: z.string().min(1),
  patientAgeYears: z.number().int().min(40).max(59),
  gender: z.enum(['MALE', 'FEMALE']),
  systolicBloodPressureMmHg: z.number().min(60).max(300),
  resolvedBmi: z.number().positive(),
  isCurrentSmoker: z.boolean(),
  riskCategory: z.enum([
    'UNDER_5_PERCENT',
    '5_TO_UNDER_10_PERCENT',
    '10_TO_UNDER_20_PERCENT',
    '20_TO_UNDER_30_PERCENT',
    '30_PERCENT_AND_ABOVE',
  ]),
  riskLevel: z.enum([
    'LOW_RISK',
    'MODERATE_RISK',
    'HIGH_RISK',
    'VERY_HIGH_RISK',
  ]),
  isHypertensiveCrisis: z.boolean(),
  identifiedGapsSummary: z.array(z.string()).optional(),
  preferredLanguage: z.literal('id_ID').optional(),
});

// Guardrail regex patterns
const PROHIBITED_DIAGNOSTIC_PATTERNS = [
  /\b(?:anda|pasien)\s+(?:positif\s+(?:terkena|mengidap)|menderita|mengidap|terdiagnosa|divonis)\b/i,
  /\b(?:vonis\s+(?:anda|medis)|diagnosis\s+pasti|mendiagnosis\s+anda)\b/i,
  /\b(?:divonis\s+sakit|divonis\s+menderita)\b/i,
];

const PROHIBITED_DRUG_NAMES = [
  /\b(?:amlodipin|captopril|lisinopril|ramipril|losartan|valsartan|bisoprolol|atenolol|metoprolol|furosemide|spironolactone)\b/i,
  /\b(?:metformin|glibenclamid|glimepirid|insulin|acarbose|pioglitazone)\b/i,
  /\b(?:simvastatin|atorvastatin|rosuvastatin|gemfibrozil|fenofibrat)\b/i,
  /\b(?:aspilet|aspirin|clopidogrel|warfarin)\b/i,
];

const PROHIBITED_DOSING_PATTERNS = [
  /\b\d+\s*(?:mg|miligram|mcg|tablet|kapsul|ampul)\b/i,
  /\b(?:resep\s+dokter\s+untuk\s+obat|minumlah\s+obat|dosis\s+obat)\b/i,
];

const MANDATORY_DISCLAIMER_KEYWORDS = [
  'bukan diagnosis',
  'bukan pengganti',
  'konsultasi',
  'dokter',
  'tenaga medis',
];

/**
 * Validates clinical groundedness, anti-hallucination rules, and safety guardrails.
 * Returns violations list and validity status.
 */
export function validateGroundedClinicalContent(
  content: AiHealthInsightContent,
  context: SafePatientLlmContext
): GuardrailValidationResult {
  const violations: GuardrailViolation[] = [];

  // 1. Collect all generated text
  const allTexts = [
    content.headline,
    content.summaryNarration,
    ...content.primaryRiskDrivers,
    ...content.actionPlan.map((item) => item.actionText),
    content.rehabilitationPreparationNote,
  ].join(' ');

  // 2. Check Prohibited Diagnostic Declarations
  for (const pattern of PROHIBITED_DIAGNOSTIC_PATTERNS) {
    const match = pattern.exec(allTexts);
    if (match) {
      violations.push({
        code: 'GUARDRAIL_PROHIBITED_DIAGNOSTIC_CLAIM',
        message:
          'Ditemukan klaim deklaratif diagnosis penyakit yang dilarang dalam wawasan kesehatan.',
        matchedText: match[0],
      });
    }
  }

  // 3. Check Prohibited Drug Names & Dosages
  for (const pattern of PROHIBITED_DRUG_NAMES) {
    const match = pattern.exec(allTexts);
    if (match) {
      violations.push({
        code: 'GUARDRAIL_PROHIBITED_DRUG_PRESCRIPTION',
        message:
          'Ditemukan penyebutan nama obat farmasi spesifik yang dilarang diresepkan oleh LLM.',
        matchedText: match[0],
      });
    }
  }

  for (const pattern of PROHIBITED_DOSING_PATTERNS) {
    const match = pattern.exec(allTexts);
    if (match) {
      violations.push({
        code: 'GUARDRAIL_PROHIBITED_DOSING_INSTRUCTION',
        message:
          'Ditemukan instruksi dosis atau sediaan obat yang melanggar batasan non-preskriptif.',
        matchedText: match[0],
      });
    }
  }

  // 4. Hypertensive Crisis Safeguard
  if (context.isHypertensiveCrisis) {
    const hasImmediateAction = content.actionPlan.some(
      (item) => item.urgency === 'START_IMMEDIATELY'
    );
    const mentionsEmergencyCare =
      /(?:igd|puskesmas|faskes|darurat|rumah\s+sakit|segera)/i.test(allTexts);

    if (!hasImmediateAction) {
      violations.push({
        code: 'GUARDRAIL_CRISIS_URGENCY_MISSING',
        message:
          'Pasien dalam krisis hipertensi (SBP >= 180 mmHg) wajib memiliki rencana tindakan START_IMMEDIATELY.',
      });
    }

    if (!mentionsEmergencyCare) {
      violations.push({
        code: 'GUARDRAIL_CRISIS_EMERGENCY_FACILITY_MISSING',
        message:
          'Pasien dalam krisis hipertensi wajib diarahkan ke fasilitas darurat (IGD / Puskesmas / Faskes).',
      });
    }
  }

  // 5. Anti-Hallucination on Missing Gaps
  if (context.hasActiveGaps) {
    const claimsUnmeasuredNormal =
      /(?:gula\s+darah\s+(?:anda\s+)?(?:normal|aman|terkendali)|kolesterol\s+(?:anda\s+)?(?:normal|aman|rendah))/i.exec(
        allTexts
      );
    if (claimsUnmeasuredNormal) {
      violations.push({
        code: 'GUARDRAIL_UNMEASURED_PARAMETER_ASSERTION',
        message:
          'Model menyimpulkan status normal/aman untuk parameter skrining yang masih memiliki kesenjangan aktif.',
        matchedText: claimsUnmeasuredNormal[0],
      });
    }
  }

  // 6. Mandatory Disclaimer Check
  const lowerDisclaimer = content.mandatoryDisclaimer.toLowerCase();
  const hasDisclaimerKeyword = MANDATORY_DISCLAIMER_KEYWORDS.some((kw) =>
    lowerDisclaimer.includes(kw)
  );

  if (!hasDisclaimerKeyword || content.mandatoryDisclaimer.length < 15) {
    violations.push({
      code: 'GUARDRAIL_INVALID_MANDATORY_DISCLAIMER',
      message:
        'Penafian medis wajib (mandatoryDisclaimer) tidak memuat klausul non-diagnosis resmi yang disyaratkan.',
    });
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

/**
 * Validates raw content against Zod schema and returns parsed AiHealthInsightContent
 */
export function validateHealthInsightContent(
  raw: unknown
): AiHealthInsightContent {
  const result = AiHealthInsightContentSchema.safeParse(raw);
  if (!result.success) {
    throw new ClinicalValidationError({
      instance: '/api/v1/insights/health',
      errorCode: 'ERR_INSIGHT_SCHEMA_VIOLATION',
      detail: `Struktur konten wawasan AI tidak valid: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
    });
  }
  return result.data;
}

/**
 * Validates complete response object against Zod schema
 */
export function validateHealthInsightResponse(
  raw: unknown
): AiHealthInsightResponse {
  const result = AiHealthInsightResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new ClinicalValidationError({
      instance: '/api/v1/insights/health',
      errorCode: 'ERR_INSIGHT_RESPONSE_SCHEMA_VIOLATION',
      detail: `Struktur respons wawasan AI tidak valid: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
    });
  }
  return result.data;
}

/**
 * Validates content and throws ClinicalValidationError if guardrail violations are found
 */
export function assertClinicalGuardrails(
  content: AiHealthInsightContent,
  context: SafePatientLlmContext
): void {
  const guardrailResult = validateGroundedClinicalContent(content, context);
  if (!guardrailResult.isValid) {
    throw new ClinicalValidationError({
      instance: '/api/v1/insights/health',
      errorCode: 'ERR_INSIGHT_GUARDRAIL_VIOLATION',
      detail: `Pelanggaran keselamatan klinis terdeteksi: ${guardrailResult.violations.map((v) => `${v.code} (${v.message})`).join('; ')}`,
    });
  }
}
