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
6. FORMAT OUTPUT: Wajib menghasilkan keluaran yang 100% valid sesuai skema JSON yang ditetapkan tanpa teks pembuka atau penutup di luar blok JSON.
7. BAHASA: Gunakan Bahasa Indonesia formal yang hangat, empatik, mudah dimengerti masyarakat awam, dan bebas dari jargon medis yang membingungkan.`.trim();

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

Susun wawasan edukasi kesehatan terstruktur sesuai skema JSON yang diwajibkan!`.trim();
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
