import type {
  SafePatientLlmContext,
  AiHealthInsightContent,
  AiHealthInsightResponse,
  ActionPlanItem,
} from './types.js';

export const INSIGHT_MANDATORY_DISCLAIMER =
  'Informasi ini merupakan ringkasan edukasi otomatis berbasis aturan klinis terstandarisasi dan BUKAN diagnosis medis resmi pengganti konsultasi langsung dengan dokter.';

/**
 * Returns deterministic, clinically vetted fallback content matching the patient's risk profile.
 * Executes in < 1 ms with zero network dependency.
 */
export function getSafeDeterministicFallback(
  context: SafePatientLlmContext
): AiHealthInsightContent {
  // 1. Hypertensive Crisis Red-Flag
  if (context.isHypertensiveCrisis) {
    return {
      headline:
        'PERINGATAN KLINIS: Tekanan Darah Sangat Tinggi Memerlukan Pemeriksaan Segera',
      summaryNarration: `Hasil pengukuran menunjukkan tekanan darah sistolik Anda berada pada angka ${context.systolicBloodPressureMmHg} mmHg, yang tergolong krisis hipertensi. Segera kunjungi Instalasi Gawat Darurat (IGD) atau Puskesmas terdekat hari ini untuk evaluasi dan penanganan langsung oleh dokter atau tenaga medis.`,
      primaryRiskDrivers: [
        `Tekanan darah sistolik sangat tinggi (${context.systolicBloodPressureMmHg} mmHg) memerlukan perhatian darurat.`,
        context.isCurrentSmoker
          ? 'Kebiasaan merokok aktif yang menambah beban kerja pembuluh darah.'
          : 'Indeks massa tubuh dan profil vaskular memerlukan evaluasi medis langsung.',
      ],
      actionPlan: [
        {
          category: 'MEDICAL_FOLLOWUP',
          actionText:
            'Segera kunjungi IGD atau Puskesmas terdekat hari ini untuk pemeriksaan tensi darurat.',
          urgency: 'START_IMMEDIATELY',
        },
        {
          category: 'MONITORING_ROUTINE',
          actionText:
            'Hindari aktivitas fisik berat dan istirahat dalam posisi duduk tenang hingga diperiksa tenaga medis.',
          urgency: 'START_IMMEDIATELY',
        },
      ],
      rehabilitationPreparationNote:
        'Tunda semua aktivitas latihan gerak fisik mandiri hingga kondisi tekanan darah Anda dinyatakan aman dan stabil oleh dokter.',
      mandatoryDisclaimer: INSIGHT_MANDATORY_DISCLAIMER,
    };
  }

  // 2. Non-Crisis Risk Profile
  let riskLabel = 'Rendah';
  if (
    context.riskLevel === 'HIGH_RISK' ||
    context.riskLevel === 'VERY_HIGH_RISK'
  ) {
    riskLabel = context.riskLevel === 'VERY_HIGH_RISK' ? 'Sangat Tinggi' : 'Tinggi';
  } else if (context.riskLevel === 'MODERATE_RISK') {
    riskLabel = 'Sedang';
  }

  const primaryRiskDrivers: string[] = [
    `Tekanan darah sistolik tercatat ${context.systolicBloodPressureMmHg} mmHg.`,
  ];

  if (context.isCurrentSmoker) {
    primaryRiskDrivers.push(
      'Kebiasaan merokok aktif yang mempercepat kekakuan dinding pembuluh darah.'
    );
  } else {
    primaryRiskDrivers.push(
      `Indeks massa tubuh ${context.resolvedBmi} kg/m² yang memerlukan pemeliharaan berat badan ideal.`
    );
  }

  const actionPlan: ActionPlanItem[] = [];

  // Medical follow-up
  if (context.hasActiveGaps) {
    actionPlan.push({
      category: 'MEDICAL_FOLLOWUP',
      actionText:
        'Kunjungi Puskesmas atau faskes terdekat dalam kurun waktu 14 hari untuk melengkapi skrining yang belum dilakukan serta pemeriksaan tensi berkala.',
      urgency: 'RECOMMENDED_WITHIN_14_DAYS',
    });
  } else {
    actionPlan.push({
      category: 'MEDICAL_FOLLOWUP',
      actionText:
        'Konsultasikan hasil evaluasi tensi darah ini dengan dokter di Puskesmas terdekat guna perencanaan pemeliharaan kesehatan jangka panjang.',
      urgency:
        context.riskLevel === 'HIGH_RISK' ||
        context.riskLevel === 'VERY_HIGH_RISK'
          ? 'RECOMMENDED_WITHIN_14_DAYS'
          : 'ROUTINE_MONTHLY',
    });
  }

  // Lifestyle modification
  actionPlan.push({
    category: 'LIFESTYLE_MODIFICATION',
    actionText:
      'Terapkan pola makan gizi seimbang dengan membatasi konsumsi garam harian maksimal satu sendok teh dan mengurangi lemak jenuh.',
    urgency: 'START_IMMEDIATELY',
  });

  // Smoking cessation or monitoring routine
  if (context.isCurrentSmoker) {
    actionPlan.push({
      category: 'LIFESTYLE_MODIFICATION',
      actionText:
        'Konsultasikan program berhenti merokok secara bertahap di fasilitas pelayanan kesehatan.',
      urgency: 'START_IMMEDIATELY',
    });
  } else {
    actionPlan.push({
      category: 'MONITORING_ROUTINE',
      actionText:
        'Lakukan pemantauan laju denyut nadi dan tekanan darah secara teratur.',
      urgency: 'ROUTINE_MONTHLY',
    });
  }

  return {
    headline: `Profil Risiko Kardiovaskular Anda Berada pada Tingkat ${riskLabel}`,
    summaryNarration: `Hasil skrining menunjukkan estimasi risiko kardiovaskular 10 tahun Anda berada pada kategori ${riskLabel}. Sangat dianjurkan untuk mendiskusikan hasil ini dengan dokter di fasilitas pelayanan kesehatan terdekat guna perencanaan pola hidup yang lebih terarah.`,
    primaryRiskDrivers,
    actionPlan,
    rehabilitationPreparationNote:
      'Pastikan Anda beristirahat cukup, tidak merasa pusing atau nyeri dada, dan ukur denyut nadi sebelum melakukan aktivitas latihan fisik mandiri.',
    mandatoryDisclaimer: INSIGHT_MANDATORY_DISCLAIMER,
  };
}

/**
 * Wraps deterministic fallback content into a fully compliant AiHealthInsightResponse
 */
export function buildFallbackInsightResponse(
  context: SafePatientLlmContext,
  evaluationId: string,
  options?: {
    provider?: string | undefined;
    latencyMs?: number | undefined;
    insightId?: string | undefined;
  }
): AiHealthInsightResponse {
  const structuredContent = getSafeDeterministicFallback(context);

  return {
    insightId:
      options?.insightId ??
      `ins-fallback-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    evaluationId,
    generatedAt: new Date().toISOString(),
    modelMeta: {
      provider: options?.provider ?? 'DETERMINISTIC_FALLBACK_TEMPLATE',
      schemaVersion: '1.0.0',
      isFallbackTemplate: true,
      latencyMs: options?.latencyMs ?? 0,
      promptTokens: 0,
      completionTokens: 0,
    },
    structuredContent,
  };
}
