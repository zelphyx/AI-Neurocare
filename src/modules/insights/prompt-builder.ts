import type {
  SafePatientLlmContext,
  GeneratedPromptPayload,
} from './types.js';

export const SYSTEM_PROMPT_TEMPLATE = `Anda adalah AI Health Mentor dan Edukator Klinis pada platform AI-Neurocare.
Tugas utama Anda adalah menyusun ringkasan edukasi kesehatan yang empatik, jelas, dan memotivasi bagi pasien berdasarkan hasil skrining klinis kardiovaskular dan kesenjangan data yang telah diverifikasi secara deterministik oleh sistem.

ATURAN KESELAMATAN KLINIS & BATASAN HUKUM (WAJIB DIPATUHI 100%):
1. ANDA BUKAN DOKTER DIAGNOSTIK. Dilarang keras menyatakan atau mengindikasikan bahwa pasien mengidap penyakit baru tertentu secara pasti.
2. DILARANG MERESEPKAN OBAT. Jangan pernah menyebutkan nama obat, dosis, atau instruksi farmakoterapi spesifik apa pun.
3. PRINSIP GROUNDEDNESS (ANTI-HALUSINASI): Anda HANYA diperbolehkan menjelaskan faktor risiko yang tercantum secara eksplisit pada payload konteks.
4. PENANGANAN DATA KOSONG (MISSING / UNPERFORMED DATA): Jika ada parameter skrining yang tercantum sebagai "belum diperiksa" atau "kedaluwarsa", jelaskan bahwa data tersebut penting untuk dilengkapi di faskes, namun DILARANG MENYIMPULKAN bahwa pasien sakit atau sehat akibat ketiadaan data tersebut.
5. PENANGANAN KRISIS HIPERTENSI: Jika isHypertensiveCrisis bernilai true, fokuskan 100% nada bicara pada imbauan darurat yang tenang agar pasien segera memeriksakan diri ke IGD/Puskesmas terdekat hari ini.
6. FORMAT OUTPUT: Wajib menghasilkan keluaran yang 100% valid sesuai skema JSON yang ditetapkan tanpa teks pembuka atau penutup di luar blok JSON. Nama kunci JSON WAJIB persis seperti contoh di bawah — DILARANG menerjemahkan, mengganti, atau menambah nama kunci.
7. BAHASA: Gunakan Bahasa Indonesia formal yang hangat, empatik, mudah dimengerti masyarakat awam, dan bebas dari jargon medis yang membingungkan. (Bahasa Indonesia hanya untuk ISI string, bukan untuk nama kunci.)`.trim();

/**
 * Exact JSON key contract the validator enforces. Embedded verbatim in the
 * user prompt because response_format:json_object only guarantees valid JSON,
 * not the schema shape — models behind proxies (no structured-output support)
 * otherwise invent their own keys and the guardrail rejects the result.
 */
const OUTPUT_CONTRACT_TEMPLATE = `Keluaran WAJIB berupa satu objek JSON dengan kunci PERSIS seperti ini (jangan ubah nama kunci, jangan tambah kunci lain):

{
  "headline": "<judul ringkas maks 120 karakter>",
  "summaryNarration": "<narasi 2-3 paragraf>",
  "primaryRiskDrivers": ["<faktor risiko 1>", "<faktor risiko 2>"],
  "actionPlan": [
    {
      "category": "<MEDICAL_FOLLOWUP | LIFESTYLE_MODIFICATION | MONITORING_ROUTINE>",
      "actionText": "<langkah konkret>",
      "urgency": "<START_IMMEDIATELY | RECOMMENDED_WITHIN_14_DAYS | ROUTINE_MONTHLY>"
    }
  ],
  "rehabilitationPreparationNote": "<petunjuk persiapan rehabilitasi>",
  "mandatoryDisclaimer": "<penafian medis resmi>"
}

Aturan nilai:
- "primaryRiskDrivers": 1-4 item string.
- "actionPlan": 2-5 item; "category" hanya boleh salah satu dari MEDICAL_FOLLOWUP, LIFESTYLE_MODIFICATION, MONITORING_ROUTINE; "urgency" hanya boleh salah satu dari START_IMMEDIATELY, RECOMMENDED_WITHIN_14_DAYS, ROUTINE_MONTHLY.`.trim();

/**
 * Returns qualitative Indonesian BMI category label
 */
export function getBmiCategoryLabel(bmi: number): string {
  if (bmi < 18.5) {
    return 'Berat Badan Kurang';
  }
  if (bmi < 23.0) {
    return 'Berat Badan Normal';
  }
  if (bmi < 25.0) {
    return 'Kelebihan Berat Badan';
  }
  return 'Obesitas';
}

/**
 * Assembles human-readable, de-identified clinical context message for LLM
 */
export function buildUserContextMessage(context: SafePatientLlmContext): string {
  const genderLabel =
    context.gender === 'MALE' ? 'Laki-Laki (MALE)' : 'Perempuan (FEMALE)';
  const smokingLabel = context.isCurrentSmoker
    ? 'Merokok Aktif (SMOKER)'
    : 'Tidak Merokok (NON_SMOKER)';
  const bmiCategory = getBmiCategoryLabel(context.resolvedBmi);

  const crisisStatus = context.isHypertensiveCrisis
    ? 'true (PERINGATAN KRISIS MEDIS: Tekanan Darah Sistolik >= 180 mmHg)'
    : 'false';

  let gapsSection = '  * Tidak ada kesenjangan data klinis aktif (data skrining lengkap dan terkini).';
  if (context.hasActiveGaps && context.identifiedGapsSummary.length > 0) {
    gapsSection = context.identifiedGapsSummary
      .map((gap) => `  * ${gap}`)
      .join('\n');
  }

  return `Berikut adalah profil data klinis terverifikasi pasien untuk disusunkan ringkasan wawasannya:
- Kelompok Usia: ${context.ageGroup} tahun
- Jenis Kelamin: ${genderLabel}
- Tekanan Darah Sistolik: ${context.systolicBloodPressureMmHg} mmHg
- Indeks Massa Tubuh (BMI): ${context.resolvedBmi} kg/m² (Kategori: ${bmiCategory})
- Status Merokok: ${smokingLabel}
- Kategori Risiko Kardiovaskular 10 Tahun WHO: ${context.riskCategory} (${context.riskLevel})
- Status Krisis Hipertensi: ${crisisStatus}
- Kesenjangan Skrining Aktif (Gaps):
${gapsSection}

${OUTPUT_CONTRACT_TEMPLATE}

Susun wawasan edukasi kesehatan terstruktur mengikuti PERSIS kontrak JSON di atas!`.trim();
}

/**
 * Builds complete prompt payload (system instruction and user message)
 */
export function buildHealthInsightPrompt(
  context: SafePatientLlmContext
): GeneratedPromptPayload {
  return {
    systemPrompt: SYSTEM_PROMPT_TEMPLATE,
    userPrompt: buildUserContextMessage(context),
  };
}
