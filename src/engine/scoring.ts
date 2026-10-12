import type { Camera, ComparisonRow, Detection, Place, PlaceLabel, PlaceScore } from '../types';
import { haversineM } from './geo';
import { type ObserverInput, inferFromDetections } from './observer';
import { visibleDetections } from './retention';

/** A true place to grade against: from truth.json (demo) or computed from the GPS track. */
export type TruthRef = { id: string; label: PlaceLabel; lat: number; lon: number };

/** Match each inferred place to the nearest true place with the same label; a hit if within hitRadiusM. */
export function scorePlaces(
  inferred: readonly Place[],
  truth: readonly TruthRef[],
  hitRadiusM: number,
): PlaceScore[] {
  return inferred.map((p) => {
    let best: TruthRef | null = null;
    let bestD = Infinity;
    for (const t of truth) {
      if (t.label !== p.label) continue;
      const d = haversineM(p, t);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return {
      inferredId: p.id,
      truthId: best?.id ?? null,
      label: p.label,
      errorM: best ? Math.round(bestD) : null,
      hit: best !== null && bestD <= hitRadiusM,
    };
  });
}

/** True places that at least one inferred place hit. */
export function foundTruthIds(scores: readonly PlaceScore[]): Set<string> {
  return new Set(scores.filter((s) => s.hit && s.truthId).map((s) => s.truthId!));
}

/**
 * Run the observer at moment T once per retention preset and grade each run.
 * This is the headline comparison: how much of a life each retention period reveals.
 */
export function compareRetention(
  detections: readonly Detection[],
  cameras: readonly Camera[],
  T: number,
  presets: readonly { id: string; hours: number | null }[],
  params: ObserverInput,
  timeZone: string,
  truth: readonly TruthRef[],
  hitRadiusM: number,
): ComparisonRow[] {
  return presets.map((preset) => {
    const visible = visibleDetections(detections, T, preset.hours);
    const result = inferFromDetections(visible, cameras, params, timeZone);
    const scores = scorePlaces(result.places, truth, hitRadiusM);
    const found = foundTruthIds(scores);
    const hitErrors = scores.filter((s) => s.hit && s.errorM !== null).map((s) => s.errorM!);
    const home = scores.find((s) => s.label === 'home');
    return {
      presetId: preset.id,
      reads: visible.length,
      placesFound: found.size,
      placesTotal: truth.length,
      meanErrorM: hitErrors.length
        ? Math.round(hitErrors.reduce((a, b) => a + b, 0) / hitErrors.length)
        : null,
      homeErrorM: home?.hit ? home.errorM : null,
      scheduleConfidence: result.schedule.predictability > 0 ? result.schedule.confidence : null,
      predictability: result.schedule.predictability,
      foundLabels: [...found],
    };
  });
}
