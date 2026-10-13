import { describe, expect, it } from 'vitest';
import { coreBounds } from '../src/engine/geo';
import { loadDemoTrack } from './load-demo';

const MIN = 60_000;

describe('coreBounds (first map view)', () => {
  it('leaves out a short trip far away and keeps the places where the time is spent', () => {
    const track = [];
    let t = 0;
    // 30 days alternating between two places in the city, one point every 5 minutes.
    for (let i = 0; i < 30 * 24 * 12; i++, t += 5 * MIN)
      track.push(i % 288 < 144 ? { lat: 37.95, lon: 23.71, t } : { lat: 38.04, lon: 23.8, t });
    // One day away, 100 km off.
    for (let i = 0; i < 24 * 12; i++, t += 5 * MIN) track.push({ lat: 37.57, lon: 22.8, t });
    const [[w, s], [e, n]] = coreBounds(track);
    expect(w).toBeLessThanOrEqual(23.71);
    expect(s).toBeLessThanOrEqual(37.95);
    expect(e).toBeGreaterThanOrEqual(23.8);
    expect(n).toBeGreaterThanOrEqual(38.04);
    expect(w).toBeGreaterThan(23.5);
    expect(s).toBeGreaterThan(37.8);
  });

  it('still returns a box for a track whose points share one timestamp', () => {
    const track = [
      { lat: 1, lon: 2, t: 0 },
      { lat: 3, lon: 4, t: 0 },
    ];
    expect(coreBounds(track)).toEqual([
      [1, 0],
      [5, 4],
    ]);
  });

  it('frames the Athens sample on the city, not the weekend in Nafplio', () => {
    const [[w, s], [e, n]] = coreBounds(loadDemoTrack('athens'));
    // Home (Nea Smyrni) and work (Marousi) inside, Nafplio (22.80 E, 37.57 N) outside.
    expect(w).toBeLessThan(23.711);
    expect(e).toBeGreaterThan(23.806);
    expect(s).toBeLessThan(37.947);
    expect(n).toBeGreaterThan(38.045);
    expect(w).toBeGreaterThan(23.3);
    expect(s).toBeGreaterThan(37.7);
  });
});
