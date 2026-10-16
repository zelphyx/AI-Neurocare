import { z } from 'zod';
import { ValidationError } from '../../shared/errors/domain-error.js';
import { trackExercise } from './state-machine.js';
import { REHAB_MANDATORY_DISCLAIMER, RehabEngineResultSchema } from './validators.js';
import type {
  ExerciseType,
  Landmark3D,
  RehabEngineResult,
} from './types.js';

/**
 * MediaPipe Pose → Rep FSM bridge (MOD-05).
 *
 * The browser/mobile client runs MediaPipe Pose (or any 33-landmark pose
 * estimator) locally and streams normalized landmark frames to this module.
 * The bridge converts each landmark frame into the tracked joint angle plus
 * the shoulder-hike indicator, then feeds the RepCountingStateMachine.
 *
 * MediaPipe Pose 33-landmark topology (BlazePose):
 *   7/8 ears, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips.
 */
export const LEFT_EAR = 7;
export const RIGHT_EAR = 8;
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_ELBOW = 13;
export const RIGHT_ELBOW = 14;
export const LEFT_WRIST = 15;
export const RIGHT_WRIST = 16;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;

export const MEDIAPIPE_POSE_LANDMARK_COUNT = 33;

export type TrackedSide = 'LEFT' | 'RIGHT';

export interface PoseFrameInput {
  frameIndex: number;
  timestampMs: number;
  landmarks: Landmark3D[];
}

const Landmark3DSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const PoseEvaluationRequestSchema = z
  .object({
    patientId: z.string().uuid({ message: 'patientId harus berupa UUID valid.' }),
    exerciseType: z.enum(['SHOULDER_ABDUCTION', 'ELBOW_FLEXION']),
    prescribedRepTarget: z.number().int().min(1).max(100),
    side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
    frames: z
      .array(
        z
          .object({
            frameIndex: z.number().int().nonnegative(),
            timestampMs: z.number().nonnegative(),
            landmarks: z.array(Landmark3DSchema).length(MEDIAPIPE_POSE_LANDMARK_COUNT),
          })
          .strict()
      )
      .min(1)
      .max(10000),
  })
  .strict();

export type PoseEvaluationRequest = z.infer<typeof PoseEvaluationRequestSchema>;

const POSE_RESPONSE_MESSAGE =
  'Evaluasi sesi gerak berbasis pose bukan pengganti penilaian terapis fisik.';

function landmarkAt(landmarks: Landmark3D[], index: number, frameIndex: number): Landmark3D {
  const landmark = landmarks[index];
  if (!landmark) {
    throw new ValidationError({
      detail: `Landmark indeks ${index} tidak ditemukan pada frame ${frameIndex}.`,
      errorCode: 'ERR_REHAB_LANDMARK_MISSING',
      status: 422,
      instance: '/api/v1/rehab/pose/evaluate',
    });
  }
  return landmark;
}

function indicesForSide(side: TrackedSide): {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  ear: number;
} {
  return side === 'LEFT'
    ? {
        shoulder: LEFT_SHOULDER,
        elbow: LEFT_ELBOW,
        wrist: LEFT_WRIST,
        hip: LEFT_HIP,
        ear: LEFT_EAR,
      }
    : {
        shoulder: RIGHT_SHOULDER,
        elbow: RIGHT_ELBOW,
        wrist: RIGHT_WRIST,
        hip: RIGHT_HIP,
        ear: RIGHT_EAR,
      };
}

/**
 * Normalized vertical shoulder-to-ear distance (lower = shoulder raised toward
 * the ear), normalized by torso length so the ratio is distance-invariant.
 */
export function computeShoulderLiftRatio(
  ear: Landmark3D,
  shoulder: Landmark3D,
  hip: Landmark3D
): number {
  const torsoLength = Math.abs(shoulder.y - hip.y);
  if (torsoLength < 1e-6) {
    return 1.0;
  }
  return Math.abs(ear.y - shoulder.y) / torsoLength;
}

/** Converts one pose frame into the FSM's per-frame angle sample. */
export function poseFrameToRehabFrame(
  poseFrame: PoseFrameInput,
  exerciseType: ExerciseType,
  side: TrackedSide
): {
  frameIndex: number;
  timestampMs: number;
  rawJointAngleDegrees: number;
  shoulderLiftRatio: number | null;
} {
  const idx = indicesForSide(side);
  const lm = poseFrame.landmarks;
  const shoulder = landmarkAt(lm, idx.shoulder, poseFrame.frameIndex);
  const elbow = landmarkAt(lm, idx.elbow, poseFrame.frameIndex);
  const wrist = landmarkAt(lm, idx.wrist, poseFrame.frameIndex);
  const hip = landmarkAt(lm, idx.hip, poseFrame.frameIndex);
  const ear = landmarkAt(lm, idx.ear, poseFrame.frameIndex);

  // Shoulder abduction: torso vector hip->shoulder vs shoulder->elbow.
  // Elbow flexion: shoulder->elbow vs elbow->wrist.
  const rawJointAngleDegrees =
    exerciseType === 'SHOULDER_ABDUCTION'
      ? angleBetween(hip, shoulder, elbow)
      : angleBetween(shoulder, elbow, wrist);

  return {
    frameIndex: poseFrame.frameIndex,
    timestampMs: poseFrame.timestampMs,
    rawJointAngleDegrees,
    // Shoulder hiking is only meaningful for abduction movements.
    shoulderLiftRatio:
      exerciseType === 'SHOULDER_ABDUCTION'
        ? computeShoulderLiftRatio(ear, shoulder, hip)
        : null,
  };
}

/** Angle at vertex b for vectors b->a and b->c, in degrees. */
function angleBetween(a: Landmark3D, b: Landmark3D, c: Landmark3D): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2 + v1.z ** 2);
  const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);
  if (mag1 < 1e-9 || mag2 < 1e-9) {
    return 180.0;
  }
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180.0) / Math.PI;
}

/**
 * Streams pose landmark frames through the angle extractor and the
 * RepCountingStateMachine, producing the standard rehab engine result.
 */
export function trackPoseExercise(
  exerciseType: ExerciseType,
  poseFrames: PoseFrameInput[],
  side: TrackedSide = 'RIGHT'
): RehabEngineResult {
  const rehabFrames = poseFrames.map((poseFrame) =>
    poseFrameToRehabFrame(poseFrame, exerciseType, side)
  );
  return trackExercise(exerciseType, rehabFrames);
}

/**
 * Full pose-session evaluation: pose frames -> FSM rep counting -> session
 * evaluation. This is the handler behind POST /api/v1/rehab/pose/evaluate.
 */
export function evaluatePoseSession(rawInput: unknown): Record<string, unknown> {
  const parsed = PoseEvaluationRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ValidationError.fromZodError(parsed.error, {
      instance: '/api/v1/rehab/pose/evaluate',
      errorCode: 'ERR_REHAB_POSE_REQUEST_VALIDATION_FAILED',
      status: 400,
    });
  }

  const request = parsed.data;
  const engineResult = trackPoseExercise(request.exerciseType, request.frames, request.side);
  RehabEngineResultSchema.parse(engineResult);

  const validRepCount = engineResult.validRepCount;
  const achievementPercent = Math.min(
    100,
    Math.round((validRepCount / request.prescribedRepTarget) * 100)
  );

  return {
    patientId: request.patientId,
    exerciseType: request.exerciseType,
    trackedSide: request.side,
    engineResult,
    achievementPercent,
    exercisePrescriptionStatus:
      validRepCount >= request.prescribedRepTarget
        ? 'TARGET_MET'
        : achievementPercent > 0
          ? 'TARGET_PARTIALLY_MET'
          : 'TARGET_NOT_MET',
    clinicalDisclaimer: POSE_RESPONSE_MESSAGE,
    medicalDisclaimer: REHAB_MANDATORY_DISCLAIMER,
  };
}
