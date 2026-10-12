import type { Detection } from '../types';

/** A run of camera reads with no silence longer than the trip gap. */
export type Trip = { reads: Detection[]; start: number; end: number };

/** Split reads (any order) into trips: a new trip starts when the gap exceeds gapMs. */
export function splitTrips(detections: readonly Detection[], gapMs: number): Trip[] {
  const sorted = [...detections].sort((a, b) => a.t - b.t);
  const trips: Trip[] = [];
  let current: Detection[] = [];
  for (const d of sorted) {
    const last = current[current.length - 1];
    if (last && d.t - last.t > gapMs) {
      trips.push(toTrip(current));
      current = [];
    }
    current.push(d);
  }
  if (current.length) trips.push(toTrip(current));
  return trips;
}

function toTrip(reads: Detection[]): Trip {
  return { reads, start: reads[0]!.t, end: reads[reads.length - 1]!.t };
}
