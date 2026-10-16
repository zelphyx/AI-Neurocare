import {
  calculateJointAngle,
  EmaAngleFilter,
} from './kinematics.js';
import type {
  ExerciseType,
  Landmark3D,
  RehabEngineResult,
  RehabFrameSample,
  RehabRepEvent,
  ShoulderHikeAlert,
} from './types.js';

/**
 * Finite State Machine — 6 states per PRD MOD-05:
 * IDLE -> ASCENDING -> TOP_HOLD -> DESCENDING -> BOTTOM_HOLD -> (back to ASCENDING)
 * plus PARTIAL_ABORT when a rise never reaches the top threshold.
 */
export type RepFSMState =
  | 'IDLE'
  | 'ASCENDING'
  | 'TOP_HOLD'
  | 'DESCENDING'
  | 'BOTTOM_HOLD'
  | 'PARTIAL_ABORT';

export interface RepFSMThresholds {
  bottomAngleDegrees: number;
  topAngleDegrees: number;
  /** Hysteresis in degrees to avoid state chatter around thresholds */
  hysteresisDegrees: number;
  /** Reps faster than this are jerked/compensated and rejected */
  minRepDurationMs: number;
  /** Shoulder lift-ratio increase (percent vs baseline) that triggers the alert */
  shoulderHikeThresholdPercent: number;
}

export const SHOULDER_ABDUCTION_THRESHOLDS: RepFSMThresholds = {
  bottomAngleDegrees: 30,
  topAngleDegrees: 150,
  hysteresisDegrees: 10,
  minRepDurationMs: 800,
  shoulderHikeThresholdPercent: 15,
};

export const ELBOW_FLEXION_THRESHOLDS: RepFSMThresholds = {
  bottomAngleDegrees: 40,
  topAngleDegrees: 140,
  hysteresisDegrees: 10,
  minRepDurationMs: 800,
  shoulderHikeThresholdPercent: 15,
};

export function getThresholds(exerciseType: ExerciseType): RepFSMThresholds {
  return exerciseType === 'SHOULDER_ABDUCTION'
    ? SHOULDER_ABDUCTION_THRESHOLDS
    : ELBOW_FLEXION_THRESHOLDS;
}

/**
 * Convenience wrapper: computes the 3-point joint angle for the tracked limb.
 * Abduction tracks shoulder (hip-shoulder-elbow); flexion tracks elbow
 * (shoulder-elbow-wrist).
 */
export function computeTrackedJointAngle(
  exerciseType: ExerciseType,
  hip: Landmark3D,
  shoulder: Landmark3D,
  elbow: Landmark3D,
  wrist: Landmark3D
): number {
  return exerciseType === 'SHOULDER_ABDUCTION'
    ? calculateJointAngle(hip, shoulder, elbow)
    : calculateJointAngle(shoulder, elbow, wrist);
}

interface RepInProgress {
  startTimestampMs: number;
  peakAngleDegrees: number;
}

/**
 * Rep Counting Finite State Machine (MOD-05).
 * Consumes smoothed per-frame angle samples; counts a valid rep only when a
 * full ASCENDING -> TOP_HOLD -> DESCENDING -> BOTTOM_HOLD cycle completes in
 * at least `minRepDurationMs`. Partial rises never count. Jerked reps
 * (< min duration) are recorded but rejected.
 */
export class RepCountingStateMachine {
  public state: RepFSMState = 'IDLE';
  private readonly thresholds: RepFSMThresholds;
  private readonly reps: RehabRepEvent[] = [];
  private readonly partialRepTimestamps: number[] = [];
  private readonly shoulderHikeAlerts: ShoulderHikeAlert[] = [];

  private currentRep: RepInProgress | null = null;
  private baselineShoulderRatio: number | null = null;
  private baselineSampleCount = 0;
  private static readonly BASELINE_CALIBRATION_FRAMES = 5;
  private minAngle = Number.POSITIVE_INFINITY;
  private maxAngle = Number.NEGATIVE_INFINITY;
  private totalFrames = 0;

  constructor(
    private readonly exerciseType: ExerciseType,
    thresholds?: Partial<RepFSMThresholds>
  ) {
    this.thresholds = { ...getThresholds(exerciseType), ...thresholds };
  }

  /**
   * Processes one frame. `shoulderLiftRatio` is the normalized vertical
   * shoulder-to-ear distance (lower = shoulder raised toward the ear).
   */
  public processFrame(frame: RehabFrameSample): void {
    this.totalFrames += 1;
    const angle = frame.rawJointAngleDegrees;
    this.minAngle = Math.min(this.minAngle, angle);
    this.maxAngle = Math.max(this.maxAngle, angle);

    this.detectShoulderHike(frame);

    const { bottomAngleDegrees, topAngleDegrees, hysteresisDegrees } = this.thresholds;

    switch (this.state) {
      case 'IDLE':
        if (angle <= bottomAngleDegrees + hysteresisDegrees) {
          this.state = 'ASCENDING';
          this.currentRep = { startTimestampMs: frame.timestampMs, peakAngleDegrees: angle };
        }
        break;

      case 'ASCENDING': {
        if (this.currentRep) {
          this.currentRep.peakAngleDegrees = Math.max(
            this.currentRep.peakAngleDegrees,
            angle
          );
        }
        if (angle >= topAngleDegrees) {
          this.state = 'TOP_HOLD';
        }
        break;
      }

      case 'TOP_HOLD':
        if (angle <= topAngleDegrees - hysteresisDegrees) {
          this.state = 'DESCENDING';
        }
        break;

      case 'DESCENDING':
        if (angle <= bottomAngleDegrees) {
          this.state = 'BOTTOM_HOLD';
        }
        break;

      case 'BOTTOM_HOLD': {
        // The bottom was reached — the rep is complete regardless of whether
        // the next frame rests or starts rising again.
        this.finalizeRep(frame.timestampMs);
        this.state = 'ASCENDING';
        this.currentRep = { startTimestampMs: frame.timestampMs, peakAngleDegrees: angle };
        break;
      }

      case 'PARTIAL_ABORT':
        if (angle <= bottomAngleDegrees + hysteresisDegrees) {
          this.state = 'ASCENDING';
          this.currentRep = { startTimestampMs: frame.timestampMs, peakAngleDegrees: angle };
        }
        break;
    }
  }

  /**
   * Aborts the current rise without reaching the top — recorded as a partial rep
   */
  public abortPartial(frame: RehabFrameSample): void {
    if (this.state === 'ASCENDING' && this.currentRep) {
      this.partialRepTimestamps.push(frame.timestampMs);
      this.currentRep = null;
      this.state = 'PARTIAL_ABORT';
    }
  }

  private finalizeRep(endTimestampMs: number): void {
    if (!this.currentRep) {
      return;
    }
    const durationMs = endTimestampMs - this.currentRep.startTimestampMs;
    const accepted = durationMs >= this.thresholds.minRepDurationMs;

    this.reps.push({
      repNumber: this.reps.length + 1,
      startTimestampMs: this.currentRep.startTimestampMs,
      endTimestampMs,
      durationMs,
      peakAngleDegrees: this.currentRep.peakAngleDegrees,
      accepted,
      rejectionReason: accepted ? undefined : 'TOO_JERKY',
    });
    this.currentRep = null;
  }

  /**
   * Compensation detection: tracks a baseline shoulder-to-ear ratio during the
   * first frames, then fires an alert whenever the ratio rises more than 15%
   * above baseline (shoulder hiking toward the ear).
   */
  private detectShoulderHike(frame: RehabFrameSample): void {
    const ratio = frame.shoulderLiftRatio;
    if (ratio === null || ratio === undefined) {
      return;
    }
    // Calibrate the resting baseline over the first frames only, then freeze it
    // so compensation is measured against the patient's true neutral posture.
    if (this.baselineSampleCount < RepCountingStateMachine.BASELINE_CALIBRATION_FRAMES) {
      this.baselineShoulderRatio =
        this.baselineShoulderRatio === null
          ? ratio
          : (this.baselineShoulderRatio * this.baselineSampleCount + ratio) /
            (this.baselineSampleCount + 1);
      this.baselineSampleCount += 1;
      return;
    }

    const baseline = this.baselineShoulderRatio;
    if (baseline === null) {
      return;
    }

    const liftPercent = ((baseline - ratio) / baseline) * 100;
    if (liftPercent > this.thresholds.shoulderHikeThresholdPercent) {
      this.shoulderHikeAlerts.push({
        frameIndex: frame.frameIndex,
        timestampMs: frame.timestampMs,
        liftRatioPercent: Math.round(liftPercent * 100) / 100,
      });
    }
  }

  /**
   * Terminates any in-flight rep at the end of the stream and assembles results
   */
  public finish(): RehabEngineResult {
    if (this.currentRep && (this.state === 'ASCENDING' || this.state === 'PARTIAL_ABORT')) {
      if (this.state === 'ASCENDING') {
        this.partialRepTimestamps.push(this.currentRep.startTimestampMs);
      }
      this.currentRep = null;
    }

    return {
      exerciseType: this.exerciseType,
      totalFrameCount: this.totalFrames,
      validRepCount: this.reps.filter((r) => r.accepted).length,
      partialRepCount: this.partialRepTimestamps.length,
      rejectedRepCount: this.reps.filter((r) => !r.accepted).length,
      reps: this.reps,
      shoulderHikeAlerts: this.shoulderHikeAlerts,
      minObservedAngleDegrees:
        this.minAngle === Number.POSITIVE_INFINITY ? 0 : this.minAngle,
      maxObservedAngleDegrees:
        this.maxAngle === Number.NEGATIVE_INFINITY ? 0 : this.maxAngle,
    };
  }
}

/**
 * Streams an angle sequence through an EMA filter + FSM in one pass
 */
export function trackExercise(
  exerciseType: ExerciseType,
  frames: RehabFrameSample[]
): RehabEngineResult {
  const fsm = new RepCountingStateMachine(exerciseType);
  const ema = new EmaAngleFilter();

  for (const frame of frames) {
    fsm.processFrame({
      ...frame,
      rawJointAngleDegrees: ema.push(frame.rawJointAngleDegrees),
    });
  }

  return fsm.finish();
}
