import { describe, expect, it } from 'vitest';
import { normalizeTrack } from '../src/data/gpx';
import { detect } from '../src/engine/detection';
import { groundTruthFromTrack } from '../src/engine/ground-truth';
import { inferFromDetections } from '../src/engine/observer';
import { defaultEngineParams } from '../src/engine/params';
import { visibleDetections } from '../src/engine/retention';
import { scorePlaces } from '../src/engine/scoring';
import { localTime } from '../src/engine/time';
import type { Detection } from '../src/types';
import { demoCameras, loadDemoFiles, loadManifest, loadTruth } from './load-demo';

/**
 * End-to-end on the committed demo personas: GPX → reads → retention → observer,
 * graded against the persona's truth.json.
 */

const p = defaultEngineParams();

/** Deterministic Fisher–Yates shuffle. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  let seed = 42;
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
const HOUR = 3_600_000;

// DEMO=atlanta npx vitest run tests/demo-e2e.test.ts  — run one persona only
const only = process.env.DEMO;

for (const entry of loadManifest().filter((e) => !only || e.slug === only)) {
  describe(`demo: ${entry.slug} (${entry.cameraMode} cameras)`, () => {
    const files = loadDemoFiles(entry.slug);
    const track = normalizeTrack(files).points;
    const truth = loadTruth(entry.slug);
    const tz = truth.timeZone;
    const cameras = demoCameras(entry.slug, entry.cameraMode);
    const reads = detect(track, cameras, p.detection);
    const T = track[track.length - 1]!.t;
    const at = (hours: number | null) => {
      const visible = visibleDetections(reads, T, hours);
      const result = inferFromDetections(visible, cameras, p, tz);
      return { visible, result, scores: scorePlaces(result.places, truth.places, 500) };
    };
    const found = (hours: number | null, truthId: string) =>
      at(hours).scores.some((s) => s.hit && s.truthId === truthId);
    const rally = truth.places.find((t) => t.sensitive)!;

    it('covers about five weeks, so every retention preset differs', () => {
      expect((T - track[0]!.t) / (24 * HOUR)).toBeGreaterThan(33);
      expect(reads.length).toBeGreaterThan(500);
    });

    it('with 21 d retention at the end of the data, home and work are found within 500 m', () => {
      const { result, scores } = at(21 * 24);
      for (const label of ['home', 'work'] as const) {
        const place = result.places.find((x) => x.label === label);
        expect(place, label).toBeDefined();
        const s = scores.find((x) => x.inferredId === place!.id)!;
        expect(s.hit, `${label} off by ${s.errorM} m`).toBe(true);
      }
    });

    it('finds the rare one-off visit at 21 d but not at 10 d', () => {
      expect(rally).toBeDefined();
      expect(found(21 * 24, rally.id)).toBe(true);
      expect(found(10 * 24, rally.id)).toBe(false);
      expect(found(null, rally.id)).toBe(true);
    });

    it('with 48 h retention the observer only sees the last two days', () => {
      const { visible, result } = at(48);
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((d) => d.t >= T - 48 * HOUR && d.t <= T)).toBe(true);
      expect(result.stats.daysCovered).toBeLessThanOrEqual(3);
      const days = new Set(visible.map((d) => localTime(d.t, tz).dayKey));
      const lastTwo = new Set([
        localTime(T, tz).dayKey,
        localTime(T - 24 * HOUR, tz).dayKey,
        localTime(T - 48 * HOUR, tz).dayKey,
      ]);
      for (const d of days) expect(lastTwo.has(d)).toBe(true);
    });

    it('longer retention never reveals less', () => {
      const counts = [48, 7 * 24, 10 * 24, 21 * 24, 30 * 24, null].map((h) => {
        const { scores } = at(h);
        return new Set(scores.filter((s) => s.hit).map((s) => s.truthId)).size;
      });
      for (let i = 1; i < counts.length; i++)
        expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]! - 1);
      expect(counts[5]!).toBeGreaterThan(counts[0]!);
    });

    it('ground truth from the full GPS track recovers the persona’s real places', () => {
      const gt = groundTruthFromTrack(track, p, tz);
      const scores = scorePlaces(gt.places, truth.places, 150);
      const hits = new Set(scores.filter((s) => s.hit).map((s) => s.truthId));
      expect(hits.has('home')).toBe(true);
      expect(hits.has('work')).toBe(true);
      expect(hits.has(rally.id)).toBe(true);
    });

    it('gives identical results when the input files are shuffled', () => {
      const shuffled = normalizeTrack(loadDemoFiles(entry.slug, shuffle)).points;
      expect(shuffled).toEqual(track);
      const again: Detection[] = detect(shuffled, cameras, p.detection);
      expect(again).toEqual(reads);
      const a = inferFromDetections(visibleDetections(again, T, 21 * 24), cameras, p, tz);
      expect(a).toEqual(at(21 * 24).result);
    });
  });
}
