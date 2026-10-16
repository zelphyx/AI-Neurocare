import type {
  RecoveryWeekMetrics,
  RecoveryStatus,
  RedFlag,
  RecoveryNarrativeContent,
} from './types.js';
import { MANDATORY_RECOVERY_DISCLAIMER } from './validators.js';

export const SAFETY_PAUSE_GUIDANCE =
  'Hentikan seluruh sesi latihan fisik secara segera. Jangan melanjutkan latihan mandiri sebelum dinyatakan aman oleh dokter atau fisioterapis.';

/**
 * Builds deterministic, clinically vetted fallback narrative per recovery status.
 * Executes in < 1 ms with zero network dependency and zero cure claims.
 */
export function getSafeRecoveryFallback(
  status: RecoveryStatus,
  metrics: RecoveryWeekMetrics,
  redFlags: RedFlag[]
): RecoveryNarrativeContent {
  // 1. SAFETY_PAUSE — red flag reported
  if (status === 'SAFETY_PAUSE') {
    const flagNames = redFlags.map((f) => f.code).join(', ');
    return {
      headline:
        'KEAMANAN UTAMA: Latihan Dijeda Sementara karena Ada Laporan Gejala',
      summaryNarration: `Sistem mendeteksi laporan gejala yang memerlukan perhatian (${flagNames}). Sesuai protokol keselamatan rehabilitasi, seluruh sesi latihan fisik dijeda terlebih dahulu. ${SAFETY_PAUSE_GUIDANCE} Segera hubungi dokter atau fisioterapis Anda hari ini untuk evaluasi kondisi sebelum melanjutkan program pemulihan.`,
      positiveProgressNotes: [
        'Keputusan Anda melaporkan gejala adalah langkah yang tepat dan sangat kami apresiasi.',
      ],
      cautionNotes: [
        'Jangan memaksakan latihan saat mengalami pusing atau nyeri dada.',
        'Dampingi posisi istirahat dengan duduk atau berbaring tenang hingga gejala mereda.',
      ],
      nextWeekGuidance: [
        'Konsultasikan gejala yang dirasakan ke dokter atau fisioterapis hari ini.',
        'Lanjutkan latihan hanya setelah mendapat persetujuan dan rencana aman dari tenaga medis.',
      ],
      mandatoryDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
    };
  }

  // 2. INSUFFICIENT_DATA — gatekeeper locked, zero trend interpretation
  if (status === 'INSUFFICIENT_DATA') {
    return {
      headline: 'Data Minggu Ini Belum Cukup untuk Evaluasi Tren Pemulihan',
      summaryNarration: `Pada minggu ini sistem hanya mencatat ${metrics.completedSessionCount} sesi latihan selesai dalam ${metrics.observationDays} hari observasi. Agar laporan pemulihan mingguan dapat disusun secara akurat, dibutuhkan minimal 2 sesi latihan yang tercatat dalam rentang minimal 3 hari berbeda. Data yang lebih lengkap membantu tim kesehatan memahami perkembangan Anda tanpa mengambil kesimpulan yang keliru.`,
      positiveProgressNotes: [
        'Setiap sesi yang Anda catat adalah langkah nyata dalam proses pemulihan.',
      ],
      cautionNotes: [
        'Sistem sengaja tidak menafsirkan tren apa pun dari data yang belum lengkap.',
      ],
      nextWeekGuidance: [
        'Coba lengkapi minimal 2 sesi latihan pada hari yang berbeda minggu depan.',
        'Catat ROM dan denyut nadi istirahat setiap kali sesi dilakukan.',
      ],
      mandatoryDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
    };
  }

  // 3. Trend-based statuses (IMPROVING / STABLE / DECLINING)
  const deltaRom = metrics.deltaRomDegrees ?? 0;
  const romText = metrics.currentWeekAvgRomDegrees ?? 'tidak tercatat';

  if (status === 'IMPROVING') {
    return {
      headline: 'Kemajuan Mingguan Anda Meningkat, Pertahankan Ritme Ini',
      summaryNarration: `Minggu ini menunjukkan kemajuan yang menggembirakan. Rentang gerak (ROM) rata-rata Anda tercatat ${romText} derajat, meningkat ${deltaRom} derajat dibanding minggu sebelumnya, dengan tingkat kepatuhan latihan ${metrics.adherencePercent}%. Kemajuan bertahap seperti ini merupakan pola pemulihan yang sehat. Tetap komunikasikan perkembangan Anda kepada fisioterapis agar program latihan dapat disesuaikan.`,
      positiveProgressNotes: [
        `Rentang gerak (ROM) meningkat ${deltaRom} derajat dibanding minggu lalu.`,
        `Kepatuhan latihan tercatat ${metrics.adherencePercent}%.`,
      ],
      cautionNotes: [
        'Hindari menambah beban atau intensitas latihan tanpa arahan fisioterapis.',
      ],
      nextWeekGuidance: [
        'Pertahankan jadwal latihan yang telah disetujui fisioterapis.',
        'Catat setiap sesi beserta ROM dan denyut nadi istirahat agar tren terpantau.',
      ],
      mandatoryDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
    };
  }

  if (status === 'DECLINING') {
    return {
      headline: 'Rentang Gerak Minggu Ini Menurun, Mari Periksa Bersama',
      summaryNarration: `Minggu ini rata-rata rentang gerak (ROM) Anda tercatat ${romText} derajat, menurun ${Math.abs(deltaRom)} derajat dibanding minggu sebelumnya, dengan tingkat kepatuhan latihan ${metrics.adherencePercent}%. Penurunan mingguan dapat terjadi karena kelelahan atau jadwal yang padat, namun tetap perlu dipantau. Diskusikan pola ini dengan fisioterapis agar teknik atau program latihan dapat disesuaikan.`,
      positiveProgressNotes: [
        'Konsistensi Anda tetap mencatat latihan adalah fondasi penting bagi pemulihan.',
      ],
      cautionNotes: [
        'Jangan memaksakan rentang gerak hingga menimbulkan nyeri.',
        'Hentikan latihan dan konsultasikan bila muncul pusing atau nyeri dada.',
      ],
      nextWeekGuidance: [
        'Jadwalkan evaluasi teknik latihan bersama fisioterapis minggu ini.',
        'Kembali ke rentang gerak yang nyaman sesuai arahan fisioterapis sebelum menaikkan intensitas.',
      ],
      mandatoryDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
    };
  }

  // STABLE
  return {
    headline: 'Kemajuan Anda Stabil, Fondasi yang Baik untuk Melanjutkan Program',
    summaryNarration: `Minggu ini rentang gerak (ROM) rata-rata Anda tercatat ${romText} derajat dan berada pada rentang stabil dibanding minggu sebelumnya, dengan tingkat kepatuhan latihan ${metrics.adherencePercent}%. Kestabilan pada fase pemulihan adalah hal yang wajar dan menunjukkan tubuh Anda beradaptasi dengan program latihan. Diskusikan progres jangka panjang Anda dengan fisioterapis pada jadwal evaluasi berikutnya.`,
    positiveProgressNotes: [
      'Rentang gerak (ROM) terjaga stabil dibanding minggu lalu.',
      `Kepatuhan latihan tercatat ${metrics.adherencePercent}%.`,
    ],
    cautionNotes: [
      'Jaga ritme latihan dan istirahat yang cukup di antara sesi.',
    ],
    nextWeekGuidance: [
      'Lanjutkan program latihan mingguan sesuai jadwal yang disetujui fisioterapis.',
      'Laporkan segera bila muncul pusing, nyeri dada, atau sesak napas saat beraktivitas.',
    ],
    mandatoryDisclaimer: MANDATORY_RECOVERY_DISCLAIMER,
  };
}

/**
 * Wraps deterministic fallback narrative into a complete response envelope segment
 */
export function buildRecoveryFallbackNarrative(
  status: RecoveryStatus,
  metrics: RecoveryWeekMetrics,
  redFlags: RedFlag[],
  provider = 'DETERMINISTIC_FALLBACK_TEMPLATE'
): { narrative: RecoveryNarrativeContent; latencyMs: number } {
  const startedAt = performance.now();
  const narrative = getSafeRecoveryFallback(status, metrics, redFlags);
  const latencyMs = Math.round(performance.now() - startedAt);
  void provider;
  return { narrative, latencyMs };
}
