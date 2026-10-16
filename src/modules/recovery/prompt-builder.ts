import type {
  RecoveryWeekMetrics,
  RecoveryStatus,
  GeneratedRecoveryPromptPayload,
  RedFlag,
} from './types.js';

export const RECOVERY_SYSTEM_PROMPT_TEMPLATE = `Anda adalah Recovery Coach AI pada platform AI-Neurocare untuk pasien rehabilitasi gerak pasca-stroke.
Tugas Anda adalah menyusun ringkasan kemajuan pemulihan mingguan yang memotivasi, berbasis fakta, dan aman secara klinis.

ATURAN KESELAMATAN & GROUNDEDNESS (WAJIB DIPATUHI 100%):
1. DILARANG MENYATAKAN KLIAM KESBUHAN. Jangan pernah mengatakan pasien "sembuh", "menyembuhkan", atau telah pulih sepenuhnya.
2. DILARANG MERESEPKAN OBAT atau menyebut nama obat, dosis, maupun instruksi farmakoterapi.
3. HANYA GUNAKAN FAKTA dari payload metrik mingguan yang diberikan (Delta ROM, Delta BPM, Adherence %). Dilarang menambahkan angka atau klaim di luar payload.
4. JIKA STATUS SAFETY_PAUSE: fokuskan 100% nada pada penghentian latihan sementara dan imbauan menghubungi dokter/fisioterapis hari ini.
5. JIKA STATUS INSUFFICIENT_DATA: dorong pasien melengkapi pencatatan (minimal 3 hari observasi dan 2 sesi), TANPA menafsirkan tren apa pun.
6. FORMAT OUTPUT: keluaran 100% valid sesuai skema JSON tanpa teks di luar blok JSON.
7. BAHASA: Bahasa Indonesia formal yang hangat dan mudah dimengerti.`.trim();

/**
 * Assembles human-readable, de-identified weekly metrics message for the LLM
 */
export function buildRecoveryUserContextMessage(
  metrics: RecoveryWeekMetrics,
  status: RecoveryStatus,
  redFlags: RedFlag[]
): string {
  const flagSection =
    redFlags.length > 0
      ? redFlags.map((f) => `  * ${f.code} (dari: ${f.detectedFrom})`).join('\n')
      : '  * Tidak ada tanda bahaya (red flag) yang terdeteksi.';

  return `Berikut adalah metrik pemulihan mingguan terverifikasi pasien untuk disusunkan ringkasan naratifnya:
- Status Evaluasi: ${status}
- Jumlah Hari Observasi: ${metrics.observationDays} hari
- Sesi Latihan Selesai: ${metrics.completedSessionCount} sesi (adherence ${metrics.adherencePercent}%)
- Rata-rata ROM Minggu Ini: ${metrics.currentWeekAvgRomDegrees ?? 'tidak tercatat'} derajat
- Rata-rata ROM Minggu Lalu: ${metrics.previousWeekAvgRomDegrees ?? 'tidak tercatat'} derajat
- Delta ROM: ${metrics.deltaRomDegrees ?? 'tidak dapat dihitung'} derajat
- Rata-rata BPM Istirahat Minggu Ini: ${metrics.currentWeekAvgBpm ?? 'tidak tercatat'}
- Rata-rata BPM Istirahat Minggu Lalu: ${metrics.previousWeekAvgBpm ?? 'tidak tercatat'}
- Delta BPM Istirahat: ${metrics.deltaBpm ?? 'tidak dapat dihitung'}
- Tanda Bahaya Terdeteksi:
${flagSection}

Susun naratif pemulihan mingguan terstruktur sesuai skema JSON yang diwajibkan!`.trim();
}

/**
 * Builds the complete recovery prompt payload (system instruction + user message)
 */
export function buildRecoveryPrompt(
  metrics: RecoveryWeekMetrics,
  status: RecoveryStatus,
  redFlags: RedFlag[]
): GeneratedRecoveryPromptPayload {
  return {
    systemPrompt: RECOVERY_SYSTEM_PROMPT_TEMPLATE,
    userPrompt: buildRecoveryUserContextMessage(metrics, status, redFlags),
  };
}
