/**
 * Types & Domain Definitions for AI Motion Rehabilitation Engine (MOD-05)
 * Pose-landmark based exercise tracking (MediaPipe-compatible 3D landmarks).
 */

export interface Landmark3D {
  x: number;
  y: number;
  z: number;
}

export type ExerciseType = 'SHOULDER_ABDUCTION' | 'ELBOW_FLEXION';

export interface RehabFrameSample {
  frameIndex: number;
  timestampMs: number;
  /** Angle of the tracked joint in degrees at this frame (pre-smoothed raw) */
  rawJointAngleDegrees: number;
  /** Shoulder-hiking indicator: normalized shoulder-to-ear vertical distance */
  shoulderLiftRatio: number | null | undefined;
}

export interface RehabRepEvent {
  repNumber: number;
  startTimestampMs: number;
  endTimestampMs: number;
  durationMs: number;
  peakAngleDegrees: number;
  accepted: boolean;
  rejectionReason?: 'TOO_JERKY' | undefined;
}

export interface ShoulderHikeAlert {
  frameIndex: number;
  timestampMs: number;
  liftRatioPercent: number;
}

export interface RehabEngineResult {
  exerciseType: ExerciseType;
  totalFrameCount: number;
  validRepCount: number;
  partialRepCount: number;
  rejectedRepCount: number;
  reps: RehabRepEvent[];
  shoulderHikeAlerts: ShoulderHikeAlert[];
  minObservedAngleDegrees: number;
  maxObservedAngleDegrees: number;
}

export interface RehabSessionEvaluationRequest {
  patientId: string;
  exerciseType: ExerciseType;
  prescribedRepTarget: number;
  engineResult: RehabEngineResult;
}

export interface RehabSessionEvaluationResponse {
  sessionId: string;
  patientId: string;
  exerciseType: ExerciseType;
  evaluatedAt: string;
  validRepCount: number;
  prescribedRepTarget: number;
  achievementPercent: number;
  partialRepCount: number;
  rejectedRepCount: number;
  avgPeakAngleDegrees: number;
  minObservedAngleDegrees: number;
  maxObservedAngleDegrees: number;
  shoulderHikeAlertCount: number;
  formQuality: 'GOOD' | 'ACCEPTABLE' | 'NEEDS_SUPERVISION';
  exercisePrescriptionStatus: 'TARGET_MET' | 'TARGET_PARTIALLY_MET' | 'TARGET_NOT_MET';
  clinicalDisclaimer: string;
}
