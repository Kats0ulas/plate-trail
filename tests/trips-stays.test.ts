import { describe, expect, it } from 'vitest';
import { detectStayPoints } from '../src/engine/ground-truth';
import { stayCandidates } from '../src/engine/observer';
import { GROUND_TRUTH_DEFAULTS, OBSERVER_DEFAULTS } from '../src/engine/params';
import { splitTrips } from '../src/engine/trips';
import type { Detection, TrackPoint } from '../src/types';
import { T0, camera, mLat, mLon } from './helpers';

const MIN = 60_000;
const read = (cameraId: string, t: number, lat = 40, lon = 23): Detection => ({
  id: `${cameraId}@${t}`,
  cameraId,
  t,
  lat,
  lon,
  headingDeg: 0,
  speedKmh: 40,
  simulated: false,
});

describe('trips', () => {
  it('starts a new trip when the gap exceeds 20 minutes', () => {
    const reads = [
      read('a', T0),
      read('b', T0 + 5 * MIN),
      read('c', T0 + 26 * MIN),
      read('d', T0 + 30 * MIN),
    ];
    const trips = splitTrips(reads, OBSERVER_DEFAULTS.tripGapMs);
    expect(trips.map((t) => t.reads.map((r) => r.cameraId))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('a gap of exactly 20 minutes stays in the same trip; input order does not matter', () => {
    const reads = [read('b', T0 + 20 * MIN), read('a', T0)];
    expect(splitTrips(reads, 20 * MIN)).toHaveLength(1);
    expect(splitTrips([], 20 * MIN)).toEqual([]);
  });
});

describe('observer stay candidates', () => {
  it('places a stay between the last read of one trip and the first of the next', () => {
    const lat = 40;
    const camA = camera('A', lat, 23);
    const camB = camera('B', lat, 23 + mLon(1000, lat));
    const reads = [
      read('x', T0 - 10 * MIN, lat, 22.9),
      read('A', T0, camA.lat, camA.lon),
      read('B', T0 + 3 * 60 * MIN, camB.lat, camB.lon),
    ];
    const stays = stayCandidates(reads, [camA, camB, camera('x', lat, 22.9)], OBSERVER_DEFAULTS);
    expect(stays).toHaveLength(1);
    const s = stays[0]!;
    expect(s.arrive).toBe(T0);
    expect(s.depart).toBe(T0 + 180 * MIN);
    expect(s.radiusM).toBeCloseTo(500, -1); // half the 1 km between the cameras
    expect(s.lon).toBeCloseTo(23 + mLon(500, lat), 5);
    expect(s.cameraLabels).toEqual(['#A', '#B']);
  });

  it('uses at least 300 m of uncertainty, and drops stays bracketed by far-apart cameras', () => {
    const near = stayCandidates(
      [read('A', T0), read('A', T0 + 60 * MIN)],
      [camera('A', 40, 23)],
      OBSERVER_DEFAULTS,
    );
    expect(near[0]!.radiusM).toBe(300);
    const far = stayCandidates(
      [read('A', T0), read('B', T0 + 60 * MIN, 40, 23.2)],
      [camera('A', 40, 23), camera('B', 40, 23.2)],
      OBSERVER_DEFAULTS,
    );
    expect(far).toHaveLength(0);
  });
});

describe('ground-truth stay points', () => {
  const lat = 40;
  const at = (dxM: number, t: number): TrackPoint => ({
    lat: lat + mLat(0),
    lon: 23 + mLon(dxM, lat),
    t,
  });

  it('finds a 30-minute stay between two drives', () => {
    const pts: TrackPoint[] = [];
    let t = T0;
    for (let x = 0; x < 3000; x += 70) pts.push(at(x, (t += 5000))); // driving
    for (let k = 0; k < 7; k++) pts.push(at(3000 + (k % 2) * 20, (t += 5 * MIN))); // parked 30 min
    for (let x = 3000; x < 6000; x += 70) pts.push(at(x, (t += 5000)));
    const stays = detectStayPoints(pts, GROUND_TRUTH_DEFAULTS);
    expect(stays).toHaveLength(1);
    expect(stays[0]!.depart - stays[0]!.arrive).toBeGreaterThanOrEqual(30 * MIN);
    expect(stays[0]!.lon).toBeCloseTo(23 + mLon(3000, lat), 3);
  });

  it('merges a visit split in two by walking in from a car parked 120 m away', () => {
    const pts: TrackPoint[] = [];
    let t = T0;
    for (let x = 0; x < 2000; x += 70) pts.push(at(x, (t += 5000))); // drive
    for (let x = 2000; x <= 2120; x += 13) pts.push(at(x, (t += 10_000))); // walk 120 m
    for (let k = 0; k < 24; k++) pts.push(at(2120 + (k % 3) * 8, (t += 5 * MIN))); // 2 hours
    for (let x = 2120; x < 5000; x += 70) pts.push(at(x, (t += 5000)));
    const stays = detectStayPoints(pts, GROUND_TRUTH_DEFAULTS);
    expect(stays).toHaveLength(1);
    expect(stays[0]!.depart - stays[0]!.arrive).toBeGreaterThan(110 * MIN);
  });

  it('ignores a short stop (traffic light, 2 minutes)', () => {
    const pts: TrackPoint[] = [];
    let t = T0;
    for (let x = 0; x < 2000; x += 70) pts.push(at(x, (t += 5000)));
    for (let k = 0; k < 24; k++) pts.push(at(2000, (t += 5000)));
    for (let x = 2000; x < 4000; x += 70) pts.push(at(x, (t += 5000)));
    expect(detectStayPoints(pts, GROUND_TRUTH_DEFAULTS)).toHaveLength(0);
  });

  it('treats a recording gap at the same place as a stay', () => {
    const pts = [at(0, T0), at(10, T0 + 8 * 3_600_000)];
    expect(detectStayPoints(pts, GROUND_TRUTH_DEFAULTS)).toHaveLength(1);
  });
});
