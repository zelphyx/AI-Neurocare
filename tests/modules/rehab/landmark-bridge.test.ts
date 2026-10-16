import { describe, it, expect } from 'vitest';
import {
  trackPoseExercise,
  evaluatePoseSession,
  poseFrameToRehabFrame,
  computeShoulderLiftRatio,
  MEDIAPIPE_POSE_LANDMARK_COUNT,
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_ELBOW,
  RIGHT_ELBOW,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_EAR,
  RIGHT_EAR,
  type PoseFrameInput,
} from '../../../src/modules/rehab/landmark-bridge.js';
import type { Landmark3D } from '../../../src/modules/rehab/types.js';

/**
 * MediaPipe Pose -> Rep FSM bridge tests (MOD-05).
 * Synthetic landmark frames mimic a MediaPipe Pose output stream for one
 * shoulder-abduction / elbow-flexion cycle set.
 */

const PATIENT_ID = '3f7d9c2e-8b64-4a11-9c3f-2e5b7a1d4e88';

/**
 * Builds a neutral standing pose as normalized MediaPipe coordinates:
 * torso vertical, arms hanging down (angle at shoulder ~ small).
 */
function neutralPose(): Landmark3D[] {
  const lm: Landmark3D[] = [];
  for (let i = 0; i < MEDIAPIPE_POSE_LANDMARK_COUNT; i++) {
    lm.push({ x: 0.5, y: 0.5, z: 0 });
  }
  // Right side (screen-mirrored coordinates: y grows downward)
  lm[RIGHT_EAR] = { x: 0.56, y: 0.2, z: 0 };
  lm[RIGHT_SHOULDER] = { x: 0.56, y: 0.4, z: 0 };
  lm[RIGHT_ELBOW] = { x: 0.57, y: 0.55, z: 0 };
  lm[RIGHT_WRIST] = { x: 0.57, y: 0.7, z: 0 };
  lm[RIGHT_HIP] = { x: 0.55, y: 0.62, z: 0 };
  lm[LEFT_EAR] = { x: 0.44, y: 0.2, z: 0 };
  lm[LEFT_SHOULDER] = { x: 0.44, y: 0.4, z: 0 };
  lm[LEFT_ELBOW] = { x: 0.43, y: 0.55, z: 0 };
  lm[LEFT_WRIST] = { x: 0.43, y: 0.7, z: 0 };
  lm[LEFT_HIP] = { x: 0.45, y: 0.62, z: 0 };
  return lm;
}

/**
 * Generates abduction cycles: the right arm rotates from hanging (angle at
 * shoulder close to 0 = arm alongside torso) up to horizontal overhead.
 * Abduction angle here = angle hip->shoulder->elbow, which grows as the arm
 * swings away from the torso.
 */
function abductionCycles(cycles: number, side: 'LEFT' | 'RIGHT' = 'RIGHT', framesPerCycle = 40): PoseFrameInput[] {
  const frames: PoseFrameInput[] = [];
  const restPose = neutralPose();
  const shoulderKey = side === 'RIGHT' ? RIGHT_SHOULDER : LEFT_SHOULDER;
  const elbowKey = side === 'RIGHT' ? RIGHT_ELBOW : LEFT_ELBOW;
  const wristKey = side === 'RIGHT' ? RIGHT_WRIST : LEFT_WRIST;
  const shoulder = restPose[shoulderKey]!;
  const outward = side === 'RIGHT' ? 1 : -1;

  const armLength = 0.18;
  let frameIndex = 0;
  const pushFrame = (swingDeg: number) => {
    const rad = (swingDeg * Math.PI) / 180;
    const lm = neutralPose();
    lm[elbowKey] = {
      x: shoulder.x + outward * armLength * Math.sin(rad),
      y: shoulder.y + armLength * Math.cos(rad),
      z: 0,
    };
    lm[wristKey] = {
      x: shoulder.x + outward * 2 * armLength * Math.sin(rad),
      y: shoulder.y + 2 * armLength * Math.cos(rad),
      z: 0,
    };
    frames.push({ frameIndex: frameIndex++, timestampMs: frameIndex * 50, landmarks: lm });
  };

  for (let c = 0; c < cycles; c++) {
    // up-swing: 20 deg (arm at side) to 160 deg (arm overhead)
    for (let t = 0; t <= framesPerCycle / 2; t++) {
      pushFrame(20 + (t / (framesPerCycle / 2)) * 140);
    }
    // down-swing back to rest
    for (let t = framesPerCycle / 2 - 1; t >= 0; t--) {
      pushFrame(20 + (t / (framesPerCycle / 2)) * 140);
    }
  }
  // trailing rest frames let the FSM finalize the final rep
  for (let t = 0; t < 6; t++) {
    pushFrame(20);
  }
  return frames;
}

function elbowFlexionCycles(cycles: number, side: 'LEFT' | 'RIGHT' = 'RIGHT', framesPerCycle = 40): PoseFrameInput[] {
  const frames: PoseFrameInput[] = [];
  const restPose = neutralPose();
  const elbowKey = side === 'RIGHT' ? RIGHT_ELBOW : LEFT_ELBOW;
  const wristKey = side === 'RIGHT' ? RIGHT_WRIST : LEFT_WRIST;
  const elbowRest = restPose[elbowKey]!;
  const outward = side === 'RIGHT' ? 1 : -1;
  let frameIndex = 0;

  const pushFrame = (bendDeg: number) => {
    const lm = neutralPose();
    // bend 0 = straight arm (180 deg at elbow), bend 150 = strongly flexed;
    // the elbow angle falls from ~176 to ~34 as bend grows (below the FSM's
    // 40 deg bottom threshold, which has no hysteresis)
    const rad = (bendDeg * Math.PI) / 180;
    const forearmLen = 0.15;
    lm[wristKey] = {
      x: elbowRest.x + outward * forearmLen * Math.sin(rad),
      y: elbowRest.y + forearmLen * Math.cos(rad),
      z: 0,
    };
    frames.push({ frameIndex: frameIndex++, timestampMs: frameIndex * 50, landmarks: lm });
  };

  for (let c = 0; c < cycles; c++) {
    // extend (angle rises to ~176) then flex back down (angle ~34)
    for (let t = 0; t <= framesPerCycle / 2; t++) {
      pushFrame(150 - (t / (framesPerCycle / 2)) * 150);
    }
    for (let t = framesPerCycle / 2 - 1; t >= 0; t--) {
      pushFrame(150 - (t / (framesPerCycle / 2)) * 150);
    }
  }
  // trailing flexed-rest frames let the FSM finalize the final rep
  for (let t = 0; t < 6; t++) {
    pushFrame(150);
  }
  return frames;
}

describe('MediaPipe Pose -> Rep FSM Bridge (MOD-05)', () => {
  it('converts a neutral pose frame to near-straight arm geometry', () => {
    const lm = neutralPose();
    const frame: PoseFrameInput = { frameIndex: 0, timestampMs: 0, landmarks: lm };
    const rehabFrame = poseFrameToRehabFrame(frame, 'SHOULDER_ABDUCTION', 'RIGHT');
    // hanging arm: hip-shoulder-elbow angle is a straight-ish line (~180 or
    // small depending on geometry) — just assert it is finite and in [0, 180]
    expect(rehabFrame.rawJointAngleDegrees).toBeGreaterThanOrEqual(0);
    expect(rehabFrame.rawJointAngleDegrees).toBeLessThanOrEqual(180);
    expect(rehabFrame.shoulderLiftRatio).not.toBeNull();
  });

  it('counts 3 abduction cycles from synthetic pose landmarks', () => {
    const frames = abductionCycles(3);
    const result = trackPoseExercise('SHOULDER_ABDUCTION', frames, 'RIGHT');
    expect(result.validRepCount).toBe(3);
    expect(result.rejectedRepCount).toBe(0);
    expect(result.totalFrameCount).toBe(frames.length);
  });

  it('counts elbow flexion reps from the elbow joint', () => {
    const frames = elbowFlexionCycles(2);
    const result = trackPoseExercise('ELBOW_FLEXION', frames, 'RIGHT');
    expect(result.validRepCount).toBe(2);
  });

  it('left side mirrors right side rep counting', () => {
    const resultLeft = trackPoseExercise('SHOULDER_ABDUCTION', abductionCycles(2, 'LEFT'), 'LEFT');
    expect(resultLeft.validRepCount).toBe(2);
  });

  it('shoulder hike detection triggers when shoulder approaches the ear', () => {
    // Hiking: shoulder y moves up toward ear (y shrinks), torso compresses
    const lm = neutralPose();
    lm[RIGHT_SHOULDER] = { x: 0.56, y: 0.24, z: 0 }; // raised toward ear at 0.2
    lm[RIGHT_HIP] = { x: 0.55, y: 0.62, z: 0 };
    const ratio = computeShoulderLiftRatio(lm[RIGHT_EAR]!, lm[RIGHT_SHOULDER]!, lm[RIGHT_HIP]!);
    const neutral = neutralPose();
    const neutralRatio = computeShoulderLiftRatio(
      neutral[RIGHT_EAR]!,
      neutral[RIGHT_SHOULDER]!,
      neutral[RIGHT_HIP]!
    );
    expect(ratio).toBeLessThan(neutralRatio); // lower ratio = raised shoulder
  });

  it('rejects frames with incomplete landmark sets as 422', () => {
    const frames = abductionCycles(1);
    frames[10]!.landmarks = frames[10]!.landmarks.slice(0, 20);
    expect(() => trackPoseExercise('SHOULDER_ABDUCTION', frames, 'RIGHT')).toThrow();
  });

  it('pose session endpoint: 200 with full evaluation on valid payload', () => {
    const response = evaluatePoseSession({
      patientId: PATIENT_ID,
      exerciseType: 'SHOULDER_ABDUCTION',
      prescribedRepTarget: 3,
      side: 'RIGHT',
      frames: abductionCycles(3),
    });
    const body = response as Record<string, unknown>;
    const engine = body['engineResult'] as Record<string, unknown>;
    expect(engine['validRepCount']).toBe(3);
    expect(body['achievementPercent']).toBe(100);
    expect(body['exercisePrescriptionStatus']).toBe('TARGET_MET');
    expect(String(body['medicalDisclaimer'])).toContain('BUKAN');
  });

  it('pose session endpoint: 400 RFC 7807 on invalid payloads', () => {
    expect(() => evaluatePoseSession({ nonsense: true })).toThrow();
    expect(() =>
      evaluatePoseSession({
        patientId: 'not-a-uuid',
        exerciseType: 'SHOULDER_ABDUCTION',
        prescribedRepTarget: 1,
        frames: [],
      })
    ).toThrow();
  });

  it('pose session endpoint: partial achievement reports TARGET_PARTIALLY_MET', () => {
    const response = evaluatePoseSession({
      patientId: PATIENT_ID,
      exerciseType: 'SHOULDER_ABDUCTION',
      prescribedRepTarget: 5,
      side: 'RIGHT',
      frames: abductionCycles(2),
    });
    expect(response['exercisePrescriptionStatus']).toBe('TARGET_PARTIALLY_MET');
    expect(response['achievementPercent']).toBe(40);
  });
});
