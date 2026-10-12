import { describe, expect, it } from 'vitest';
import { detect } from '../src/engine/detection';
import { DETECTION_DEFAULTS } from '../src/engine/params';
import { T0, camera, mLat, mLon, straightDrive } from './helpers';

const P = { ...DETECTION_DEFAULTS };
const LAT = 40;
const LON0 = 23;

describe('detection', () => {
  // 50 km/h ≈ 13.9 m/s; the camera sits 500 m along the road.
  const drive = straightDrive({ lat: LAT, lon0: LON0, kmh: 50, durationS: 90 });
  const alongM = 500;
  const expectedT = T0 + (alongM / (50 / 3.6)) * 1000;

  it('a drive passing a camera at 20 m gives exactly one read at the interpolated time', () => {
    const cam = camera('a', LAT + mLat(20), LON0 + mLon(alongM, LAT));
    const reads = detect(drive, [cam], P);
    expect(reads).toHaveLength(1);
    expect(Math.abs(reads[0]!.t - expectedT)).toBeLessThan(200);
    // The read is placed at the camera, not at the GPS point.
    expect(reads[0]!.lat).toBe(cam.lat);
    expect(reads[0]!.lon).toBe(cam.lon);
    expect(reads[0]!.headingDeg).toBeGreaterThan(85);
    expect(reads[0]!.headingDeg).toBeLessThan(95);
    expect(reads[0]!.speedKmh).toBeCloseTo(50, -1);
  });

  it('a camera 100 m away reads nothing', () => {
    const cam = camera('a', LAT + mLat(100), LON0 + mLon(alongM, LAT));
    expect(detect(drive, [cam], P)).toHaveLength(0);
  });

  it('walking past a camera reads nothing while the vehicle-only filter is on', () => {
    const walk = straightDrive({ lat: LAT, lon0: LON0, kmh: 5, durationS: 600 });
    const cam = camera('a', LAT + mLat(5), LON0 + mLon(400, LAT));
    expect(detect(walk, [cam], P)).toHaveLength(0);
    expect(detect(walk, [cam], { ...P, vehicleOnly: false })).toHaveLength(1);
  });

  it('repeated passes within 2 minutes count once; later passes count again', () => {
    const cam = camera('a', LAT + mLat(10), LON0 + mLon(100, LAT));
    const there = straightDrive({ lat: LAT, lon0: LON0, kmh: 36, durationS: 20, stepS: 2 }); // 200 m east
    const end = there[there.length - 1]!.t;
    const back = [...there].reverse().map((p, i) => ({ ...p, t: end + (i + 1) * 2000 }));
    expect(detect([...there, ...back], [cam], P)).toHaveLength(1);
    const later = back.map((p) => ({ ...p, t: p.t + 5 * 60_000 }));
    expect(detect([...there, ...later], [cam], P)).toHaveLength(2);
  });

  it('no cameras, or a single point, gives no reads', () => {
    expect(detect(drive, [], P)).toEqual([]);
    expect(detect(drive.slice(0, 1), [camera('a', LAT, LON0)], P)).toEqual([]);
  });

  it('ignores segments across a recording gap', () => {
    const a = { lat: LAT, lon: LON0, t: T0 };
    const b = { lat: LAT, lon: LON0 + mLon(5000, LAT), t: T0 + 10 * 60_000 };
    const cam = camera('a', LAT, LON0 + mLon(2500, LAT));
    expect(detect([a, b], [cam], P)).toHaveLength(0);
  });

  it('direction filter keeps passes along the camera facing or its reverse only', () => {
    const facingNorth = camera('n', LAT + mLat(10), LON0 + mLon(alongM, LAT), { directions: [0] });
    const facingEast = camera('e', LAT + mLat(10), LON0 + mLon(alongM + 200, LAT), {
      directions: [270],
    });
    const withFilter = detect(drive, [facingNorth, facingEast], { ...P, directionFilter: true });
    expect(withFilter.map((d) => d.cameraId)).toEqual(['e']);
    expect(detect(drive, [facingNorth, facingEast], P)).toHaveLength(2);
  });

  it('processes a month of 5-second points quickly', () => {
    // ~535k points at 50 km/h sweeping back and forth across a 5 km grid of 400 cameras.
    const pts = [];
    const n = 535_000;
    for (let i = 0; i < n; i++) {
      const pos = (i * 70) % 10_000;
      const y = pos < 5000 ? pos : 10_000 - pos;
      const x = (Math.floor(i / 143) * 100) % 5000;
      pts.push({ lat: LAT + mLat(y), lon: LON0 + mLon(x, LAT), t: T0 + i * 5000 });
    }
    const cams = [];
    for (let i = 0; i < 20; i++)
      for (let j = 0; j < 20; j++)
        cams.push(camera(`${i}-${j}`, LAT + mLat(i * 250), LON0 + mLon(j * 250, LAT)));
    const start = performance.now();
    const reads = detect(pts, cams, P);
    expect(reads.length).toBeGreaterThan(1000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
