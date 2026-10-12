import type { Detection } from '../types';

/**
 * The retention window: what an observer can still look up at moment T.
 *
 * Boundary rule (tested): a read is visible when  T − retention ≤ t ≤ T.
 *  - Both ends are inclusive: a read exactly `retention` old has not been deleted yet,
 *    and a read at exactly T has just happened.
 *  - Reads after T do not exist yet.
 *  - `null` retention means "forever": every read with t ≤ T.
 */

const HOUR = 3_600_000;

export function windowStart(T: number, retentionHours: number | null): number {
  return retentionHours === null ? -Infinity : T - retentionHours * HOUR;
}

export function isVisible(t: number, T: number, retentionHours: number | null): boolean {
  return t <= T && t >= windowStart(T, retentionHours);
}

/** First index whose t ≥ value (array sorted by t). */
export function lowerBound(sorted: readonly { t: number }[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.t < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose t > value (array sorted by t). */
export function upperBound(sorted: readonly { t: number }[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.t <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Detections (sorted by t) an observer can still see at T. O(log n). */
export function visibleDetections(
  sorted: readonly Detection[],
  T: number,
  retentionHours: number | null,
): Detection[] {
  const from = windowStart(T, retentionHours);
  const i = from === -Infinity ? 0 : lowerBound(sorted, from);
  const j = upperBound(sorted, T);
  return sorted.slice(i, j);
}

/** 0 = just read, 1 = about to be deleted. Used to fade reads as they age. */
export function ageFraction(
  t: number,
  T: number,
  retentionHours: number | null,
  foreverScaleMs = 7 * 24 * HOUR,
): number {
  const span = retentionHours === null ? foreverScaleMs : retentionHours * HOUR;
  return Math.max(0, Math.min(1, (T - t) / span));
}
