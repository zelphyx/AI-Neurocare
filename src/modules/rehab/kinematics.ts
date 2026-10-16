import type { Landmark3D } from './types.js';

/**
 * Computes the Euclidean distance between two 3D landmarks
 */
export function distance3D(a: Landmark3D, b: Landmark3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Joint angle via vector dot-product trigonometry (MOD-05).
 *
 * Computes the angle at vertex `b` formed by segments b->a and b->c:
 *   cos(theta) = (ba . bc) / (|ba| * |bc|)
 *
 * The cosine is clamped to [-1, 1] (arccos domain) so degenerate geometry —
 * zero-length segments or floating-point overshoot — yields a defined 0 or
 * 180 degrees instead of NaN.
 */
export function calculateJointAngle(
  pointA: Landmark3D,
  vertexB: Landmark3D,
  pointC: Landmark3D
): number {
  const ba: Landmark3D = {
    x: pointA.x - vertexB.x,
    y: pointA.y - vertexB.y,
    z: pointA.z - vertexB.z,
  };
  const bc: Landmark3D = {
    x: pointC.x - vertexB.x,
    y: pointC.y - vertexB.y,
    z: pointC.z - vertexB.z,
  };

  const magnitudeBA = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
  const magnitudeBC = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);

  // Degenerate geometry: coincident points. Angle is undefined; returning 180
  // (fully straight) is the safe deterministic choice — never NaN.
  if (magnitudeBA === 0 || magnitudeBC === 0) {
    return 180.0;
  }

  const dotProduct = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const cosine = Math.min(1, Math.max(-1, dotProduct / (magnitudeBA * magnitudeBC)));

  const angleRadians = Math.acos(cosine);
  return Math.round((angleRadians * 180) / Math.PI * 100) / 100;
}

/** Default EMA smoothing factor per PRD MOD-05 (higher alpha = less lag, less smoothing) */
export const DEFAULT_EMA_ALPHA = 0.65;

/**
 * Single-step Exponential Moving Average:
 *   smoothed = alpha * current + (1 - alpha) * previous
 */
export function emaSmooth(
  previousSmoothed: number,
  currentRaw: number,
  alpha: number = DEFAULT_EMA_ALPHA
): number {
  return alpha * currentRaw + (1 - alpha) * previousSmoothed;
}

/**
 * Stateful EMA filter for streaming per-frame joint angles.
 * Damps landmark jittering frame-to-frame while keeping response latency low.
 */
export class EmaAngleFilter {
  private smoothedValue: number | null = null;

  constructor(
    public readonly alpha: number = DEFAULT_EMA_ALPHA
  ) {}

  public push(rawAngleDegrees: number): number {
    if (this.smoothedValue === null) {
      this.smoothedValue = rawAngleDegrees;
    } else {
      this.smoothedValue = emaSmooth(this.smoothedValue, rawAngleDegrees, this.alpha);
    }
    return this.smoothedValue;
  }

  public get current(): number | null {
    return this.smoothedValue;
  }

  public reset(): void {
    this.smoothedValue = null;
  }
}
