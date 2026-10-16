import { RECOVERY_CONSTANTS } from './validators.js';
import type { RecoveryWeekMetrics } from './types.js';

/**
 * Data Sufficiency Gatekeeper (MOD-03B)
 *
 * Locks the weekly evaluation status to INSUFFICIENT_DATA — blocking all trend
 * interpretation and LLM narrative generation — when observations cover fewer
 * than 3 distinct calendar days or fewer than 2 performed sessions.
 *
 * This is the hard guard against extrapolating a recovery trend from a single
 * session: an under-observed week MUST never be narrated as improving/declining.
 */
export function evaluateDataSufficiency(
  metrics: RecoveryWeekMetrics
): 'SUFFICIENT' | 'INSUFFICIENT' {
  const hasEnoughDays =
    metrics.observationDays >= RECOVERY_CONSTANTS.MIN_OBSERVATION_DAYS;
  const hasEnoughSessions =
    metrics.completedSessionCount >= RECOVERY_CONSTANTS.MIN_COMPLETED_SESSIONS;

  return hasEnoughDays && hasEnoughSessions ? 'SUFFICIENT' : 'INSUFFICIENT';
}

/**
 * Applies the gatekeeper verdict onto the metrics payload (mutates dataSufficiency)
 */
export function applyDataSufficiencyGate(
  metrics: RecoveryWeekMetrics
): RecoveryWeekMetrics {
  return {
    ...metrics,
    dataSufficiency: evaluateDataSufficiency(metrics),
  };
}
