import { describe, it, expect } from 'vitest';
import {
  calculateJointAngle,
  emaSmooth,
  EmaAngleFilter,
  distance3D,
} from '../../../src/modules/rehab/kinematics.js';
import {
  RepCountingStateMachine,
  trackExercise,
  getThresholds,
} from '../../../src/modules/rehab/state-machine.js';
import { evaluateRehabSession } from '../../../src/modules/rehab/session-evaluator.js';
import type {
  Landmark3D,
  RehabFrameSample,
  RehabSessionEvaluationRequest,
} from '../../../src/modules/rehab/types.js';

// =============================================================================
// Helpers
// =============================================================================

const P = (x: number, y: number, z = 0): Landmark3D => ({ x, y, z });

function frame(index: number, angle: number, shoulderRatio: number | null = null): RehabFrameSample {
  return { frameIndex: index, timestampMs: index * 50, rawJointAngleDegrees: angle, shoulderLiftRatio: shoulderRatio };
}

/**
 * Builds a rep cycle: rest -> rise to peak -> return to rest.
 * frameStepMs controls speed (for jerked-rep tests).
 */
function repCycle(
  startIndex: number,
  peak: number,
  opts: { frameStepMs?: number; rest?: number; start?: number; shoulderRatio?: (i: number, a: number) => number | null } = {}
): RehabFrameSample[] {
  const step = opts.frameStepMs ?? 50;
  const rest = opts.rest ?? 20;
  const start = opts.start ?? rest;
  const frames: RehabFrameSample[] = [];
  let i = startIndex;
  let t = startIndex * step;
  const push = (angle: number, ratio: number | null = null) => {
    frames.push({ frameIndex: i, timestampMs: t, rawJointAngleDegrees: angle, shoulderLiftRatio: ratio });
    i += 1;
    t += step;
  };
  push(start, opts.shoulderRatio?.(0, start) ?? null);
  // ascend in 15 steps
  for (let k = 1; k <= 15; k++) {
    push(start + ((peak - start) * k) / 15, opts.shoulderRatio?.(k, start + ((peak - start) * k) / 15) ?? null);
  }
  // hold 3 frames
  for (let k = 0; k < 3; k++) push(peak, opts.shoulderRatio?.(16 + k, peak) ?? null);
  // descend in 15 steps
  for (let k = 1; k <= 15; k++) {
    push(peak - ((peak - rest) * k) / 15, opts.shoulderRatio?.(19 + k, peak - ((peak - rest) * k) / 15) ?? null);
  }
  // rest 3 frames
  for (let k = 0; k < 3; k++) push(rest, opts.shoulderRatio?.(35 + k, rest) ?? null);
  return frames;
}

// =============================================================================
// 1. Kinematics Vector Trigonometry & EMA (Checkpoint 21)
// =============================================================================

describe('Kinematics & EMA Smoothing (Checkpoint 21)', () => {
  it('TC-REHAB-001: computes a perpendicular joint angle of exactly 90 degrees', () => {
    // Right angle at vertex B
    const angle = calculateJointAngle(P(1, 0), P(0, 0), P(0, 1));
    expect(angle).toBeCloseTo(90.0, 1);
  });

  it('TC-REHAB-001b: computes a straight joint angle of 180 degrees', () => {
    const angle = calculateJointAngle(P(1, 0), P(0, 0), P(-1, 0));
    expect(angle).toBeCloseTo(180.0, 1);
  });

  it('TC-REHAB-001c: zero-distance points return 180 degrees without NaN', () => {
    const coincident = P(0, 0);
    const angle1 = calculateJointAngle(coincident, P(0, 0), P(1, 1));
    const angle2 = calculateJointAngle(P(1, 1), P(0, 0), coincident);
    expect(Number.isNaN(angle1)).toBe(false);
    expect(Number.isNaN(angle2)).toBe(false);
    expect(angle1).toBe(180.0);
    expect(angle2).toBe(180.0);
  });

  it('TC-REHAB-001d: floating-point cosine overshoot is clamped (no NaN)', () => {
    // Nearly-collinear points can push |cos| marginally above 1
    const angle = calculateJointAngle(P(1e-9, 0), P(0, 0), P(-1e9, 1e-18));
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeLessThanOrEqual(180.0);
    expect(distance3D(P(0, 0), P(3, 4))).toBe(5);
  });

  it('TC-REHAB-002: EMA filter dampens jitter with alpha = 0.65', () => {
    expect(emaSmooth(90, 100)).toBeCloseTo(0.65 * 100 + 0.35 * 90, 6); // 96.5

    const filter = new EmaAngleFilter(0.65);
    expect(filter.push(90)).toBe(90); // first sample passes through
    expect(filter.push(120)).toBeCloseTo(0.65 * 120 + 0.35 * 90, 6);
    // Jittery input: smoothed output variance is reduced
    const jittery = [90, 110, 85, 120, 88, 115];
    const smoothed = jittery.map((v) => filter.push(v));
    const rawRange = Math.max(...jittery) - Math.min(...jittery);
    const smoothRange = Math.max(...smoothed) - Math.min(...smoothed);
    expect(smoothRange).toBeLessThan(rawRange);
  });
});

// =============================================================================
// 2. FSM Rep Counter & Shoulder Hiking (Checkpoint 22)
// =============================================================================

describe('FSM Rep Counter & Shoulder Hiking Detection (Checkpoint 22)', () => {
  it('TC-REHAB-003: a valid full cycle increments the valid rep count by exactly 1', () => {
    const result = trackExercise('SHOULDER_ABDUCTION', repCycle(0, 160));

    expect(result.validRepCount).toBe(1);
    expect(result.rejectedRepCount).toBe(0);
    expect(result.reps[0]?.accepted).toBe(true);
    expect(result.reps[0]?.peakAngleDegrees).toBeGreaterThanOrEqual(150);
    expect(result.reps[0]?.durationMs).toBeGreaterThanOrEqual(800);
  });

  it('TC-REHAB-003b: three consecutive cycles produce exactly 3 valid reps', () => {
    const frames = [
      ...repCycle(0, 160),
      ...repCycle(37, 160),
      ...repCycle(74, 160),
    ];
    const result = trackExercise('SHOULDER_ABDUCTION', frames);

    expect(result.validRepCount).toBe(3);
    expect(result.reps.map((r) => r.repNumber)).toEqual([1, 2, 3]);
  });

  it('TC-REHAB-004: a partial rise that never reaches the top adds no valid rep', () => {
    // Ascend to only 90 degrees (below the 150-degree top threshold), then rest
    const partialFrames: RehabFrameSample[] = [
      ...repCycle(0, 90).slice(0, 16), // rise phase only, stops at 90
      ...repCycle(16, 90).slice(16), // rest frames
    ];
    const result = trackExercise('SHOULDER_ABDUCTION', partialFrames);

    expect(result.validRepCount).toBe(0);
    expect(result.partialRepCount).toBeGreaterThanOrEqual(1);
  });

  it('TC-REHAB-004b: a jerked rep (< 0.8 s) is recorded but rejected as TOO_JERKY', () => {
    // 5x faster cycle: ~0.36 s total, far below the 800 ms minimum
    const result = trackExercise(
      'SHOULDER_ABDUCTION',
      repCycle(0, 160, { frameStepMs: 10 })
    );

    expect(result.reps).toHaveLength(1);
    expect(result.reps[0]?.accepted).toBe(false);
    expect(result.reps[0]?.rejectionReason).toBe('TOO_JERKY');
    expect(result.validRepCount).toBe(0);
    expect(result.rejectedRepCount).toBe(1);
  });

  it('TC-REHAB-005: shoulder hiking beyond 15% triggers compensation alerts', () => {
    // Baseline ratio 0.30; during the lift the ratio collapses to 0.20
    // => lift = (0.30 - 0.20)/0.30 = 33% > 15%
    const ratioFn = (i: number) => (i >= 5 ? 0.2 : 0.3);
    const frames = repCycle(0, 160, { shoulderRatio: ratioFn });
    const result = trackExercise('SHOULDER_ABDUCTION', frames);

    expect(result.shoulderHikeAlerts.length).toBeGreaterThan(0);
    expect(result.shoulderHikeAlerts[0]?.liftRatioPercent).toBeGreaterThan(15);
    // Rep itself is still biomechanically valid but compensation is flagged
    expect(result.validRepCount).toBe(1);
  });

  it('TC-REHAB-005b: normal shoulder movement stays below the 15% alert threshold', () => {
    const ratioFn = (i: number) => (i >= 5 ? 0.29 : 0.3); // ~3.3% lift only
    const result = trackExercise(
      'SHOULDER_ABDUCTION',
      repCycle(0, 160, { shoulderRatio: ratioFn })
    );

    expect(result.shoulderHikeAlerts).toHaveLength(0);
  });

  it('TC-REHAB-005c: elbow flexion uses its own angle thresholds', () => {
    expect(getThresholds('ELBOW_FLEXION').topAngleDegrees).toBe(140);
    expect(getThresholds('SHOULDER_ABDUCTION').topAngleDegrees).toBe(150);

    const result = trackExercise('ELBOW_FLEXION', repCycle(0, 150, { start: 45, rest: 30 }));
    expect(result.validRepCount).toBe(1);
  });
});

// =============================================================================
// 3. Backend Session Evaluator (Checkpoint 23)
// =============================================================================

describe('Backend Session Evaluator (Checkpoint 23)', () => {
  const baseEngineResult = trackExercise(
    'SHOULDER_ABDUCTION',
    [...repCycle(0, 160), ...repCycle(37, 160), ...repCycle(74, 160)]
  );

  const baseRequest: RehabSessionEvaluationRequest = {
    patientId: 'patient-rehab-001',
    exerciseType: 'SHOULDER_ABDUCTION',
    prescribedRepTarget: 3,
    engineResult: baseEngineResult,
  };

  it('TC-REHAB-006: evaluates a fully completed session (TARGET_MET, GOOD form)', () => {
    const response = evaluateRehabSession(baseRequest, { sessionId: 'reh-fixed-1' });

    expect(response.sessionId).toBe('reh-fixed-1');
    expect(response.validRepCount).toBe(3);
    expect(response.achievementPercent).toBe(100);
    expect(response.exercisePrescriptionStatus).toBe('TARGET_MET');
    expect(response.formQuality).toBe('GOOD');
    expect(response.avgPeakAngleDegrees).toBeGreaterThan(150);
    expect(response.clinicalDisclaimer).toContain('BUKAN pengganti supervisi');
  });

  it('TC-REHAB-006b: partial achievement maps to TARGET_PARTIALLY_MET', () => {
    const twoRepResult = trackExercise(
      'SHOULDER_ABDUCTION',
      [...repCycle(0, 160), ...repCycle(37, 160)]
    );
    const response = evaluateRehabSession({
      ...baseRequest,
      engineResult: twoRepResult,
    });

    expect(response.validRepCount).toBe(2);
    expect(response.achievementPercent).toBeCloseTo(66.7, 1);
    expect(response.exercisePrescriptionStatus).toBe('TARGET_PARTIALLY_MET');
  });

  it('TC-REHAB-007: compensation alerts degrade form quality to NEEDS_SUPERVISION', () => {
    const ratioFn = (i: number) => (i >= 5 ? 0.15 : 0.3); // 50% lift on every rep
    const compensatedResult = trackExercise(
      'SHOULDER_ABDUCTION',
      [
        ...repCycle(0, 160, { shoulderRatio: ratioFn }),
        ...repCycle(37, 160, { shoulderRatio: (i) => (i >= 5 ? 0.1 : 0.3) }),
      ]
    );
    const response = evaluateRehabSession({
      ...baseRequest,
      engineResult: compensatedResult,
    });

    expect(response.shoulderHikeAlertCount).toBeGreaterThan(3);
    expect(response.formQuality).toBe('NEEDS_SUPERVISION');
  });

  it('TC-REHAB-008: invalid engine payload is rejected with RFC 7807 ValidationError', () => {
    expect(() =>
      evaluateRehabSession({ ...baseRequest, patientId: '' })
    ).toThrow();

    expect(() =>
      evaluateRehabSession({ ...baseRequest, prescribedRepTarget: 0 })
    ).toThrow();

    expect(() =>
      evaluateRehabSession({ ...baseRequest, engineResult: { bogus: true } })
    ).toThrow();
  });
});
