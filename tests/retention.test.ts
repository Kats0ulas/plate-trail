import { describe, expect, it } from 'vitest';
import { RETENTION_PRESETS, presetById } from '../src/config/retention';
import { ageFraction, isVisible, visibleDetections, windowStart } from '../src/engine/retention';
import type { Detection } from '../src/types';
import { T0 } from './helpers';

const H = 3_600_000;
const det = (t: number): Detection => ({
  id: String(t),
  cameraId: 'c',
  t,
  lat: 0,
  lon: 0,
  headingDeg: 0,
  speedKmh: 50,
  simulated: false,
});

describe('retention window  T − r ≤ t ≤ T', () => {
  const T = T0 + 100 * H;

  it('includes a read exactly r old and a read exactly at T', () => {
    expect(isVisible(T - 48 * H, T, 48)).toBe(true);
    expect(isVisible(T, T, 48)).toBe(true);
  });

  it('excludes a read 1 ms older than r, and reads after T', () => {
    expect(isVisible(T - 48 * H - 1, T, 48)).toBe(false);
    expect(isVisible(T + 1, T, 48)).toBe(false);
  });

  it('"forever" includes everything up to T, and nothing after', () => {
    expect(windowStart(T, null)).toBe(-Infinity);
    expect(isVisible(0, T, null)).toBe(true);
    expect(isVisible(T + 1, T, null)).toBe(false);
  });

  it('visibleDetections slices a sorted list with the same rule', () => {
    const list = [T - 49 * H, T - 48 * H, T - 1 * H, T, T + 1].map(det);
    expect(visibleDetections(list, T, 48).map((d) => d.t)).toEqual([T - 48 * H, T - 1 * H, T]);
    expect(visibleDetections(list, T, null)).toHaveLength(4);
    expect(visibleDetections([], T, 48)).toEqual([]);
  });

  it('age fraction fades from 0 (new) to 1 (about to be deleted)', () => {
    expect(ageFraction(T, T, 48)).toBe(0);
    expect(ageFraction(T - 24 * H, T, 48)).toBeCloseTo(0.5);
    expect(ageFraction(T - 99 * H, T, 48)).toBe(1);
  });
});

describe('retention presets config', () => {
  it('has the six presets from the spec, in order, with sources', () => {
    expect(RETENTION_PRESETS.map((p) => p.hours)).toEqual([48, 168, 240, 504, 720, null]);
    for (const p of RETENTION_PRESETS) {
      expect(p.source.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
  it('falls back to the first preset for unknown ids', () => {
    expect(presetById('nope').id).toBe('48h');
    expect(presetById('21d').hours).toBe(504);
  });
});
