import type {
  RehabSessionRecord,
  RecoveryWeekMetrics,
} from './types.js';

/**
 * Returns the UTC calendar date (YYYY-MM-DD) of a session timestamp
 */
function utcDateKey(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().slice(0, 10);
}

/**
 * Returns true when the session counts as a performed session:
 * COMPLETED and PARTIAL sessions count; SKIPPED sessions do not.
 */
export function isPerformedSession(session: RehabSessionRecord): boolean {
  return session.completionStatus !== 'SKIPPED';
}

/**
 * Computes the arithmetic mean over a non-empty list, rounded to 2 decimals
 */
function mean(values: number[]): number {
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

/**
 * Longitudinal Weekly Aggregator (MOD-03B)
 * Computes deterministic week-over-week comparison metrics:
 * Delta ROM (degrees), Delta resting BPM, and Adherence % against the prescription.
 *
 * Averages only over sessions that actually carry the measurement (null-safe);
 * a missing measurement never contributes zero and never implies disease.
 */
export function aggregateWeeklyMetrics(
  currentWeekSessions: RehabSessionRecord[],
  previousWeekSessions: RehabSessionRecord[],
  prescribedSessionsPerWeek: number
): RecoveryWeekMetrics {
  const performedCurrent = currentWeekSessions.filter(isPerformedSession);

  const observationDays = new Set(
    currentWeekSessions.map((s) => utcDateKey(s.performedAt))
  ).size;

  const completedSessionCount = performedCurrent.filter(
    (s) => s.completionStatus === 'COMPLETED'
  ).length;

  const adherencePercent =
    Math.min(
      100,
      Math.round((completedSessionCount / prescribedSessionsPerWeek) * 1000) / 10
    );

  const currentRoms = performedCurrent
    .map((s) => s.romDegrees)
    .filter((v): v is number => typeof v === 'number');
  const previousRoms = previousWeekSessions
    .filter(isPerformedSession)
    .map((s) => s.romDegrees)
    .filter((v): v is number => typeof v === 'number');

  const currentBpms = performedCurrent
    .map((s) => s.restingHeartRateBpm)
    .filter((v): v is number => typeof v === 'number');
  const previousBpms = previousWeekSessions
    .filter(isPerformedSession)
    .map((s) => s.restingHeartRateBpm)
    .filter((v): v is number => typeof v === 'number');

  const currentWeekAvgRomDegrees = currentRoms.length > 0 ? mean(currentRoms) : null;
  const previousWeekAvgRomDegrees = previousRoms.length > 0 ? mean(previousRoms) : null;
  const deltaRomDegrees =
    currentWeekAvgRomDegrees !== null && previousWeekAvgRomDegrees !== null
      ? Math.round((currentWeekAvgRomDegrees - previousWeekAvgRomDegrees) * 100) / 100
      : null;

  const currentWeekAvgBpm = currentBpms.length > 0 ? mean(currentBpms) : null;
  const previousWeekAvgBpm = previousBpms.length > 0 ? mean(previousBpms) : null;
  const deltaBpm =
    currentWeekAvgBpm !== null && previousWeekAvgBpm !== null
      ? Math.round((currentWeekAvgBpm - previousWeekAvgBpm) * 100) / 100
      : null;

  return {
    observationDays,
    completedSessionCount,
    totalLoggedSessionCount: currentWeekSessions.length,
    adherencePercent,
    currentWeekAvgRomDegrees,
    previousWeekAvgRomDegrees,
    deltaRomDegrees,
    currentWeekAvgBpm,
    previousWeekAvgBpm,
    deltaBpm,
    dataSufficiency: 'SUFFICIENT',
  };
}
