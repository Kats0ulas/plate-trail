import type { Camera, TrackPoint } from '../src/types';

export const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // Tue 1 Sep 2026 12:00 UTC

/** Metres → degrees of latitude. */
export const mLat = (m: number) => m / 111_195;
/** Metres → degrees of longitude at a latitude. */
export const mLon = (m: number, lat: number) => m / (111_195 * Math.cos((lat * Math.PI) / 180));

/**
 * A straight drive due east along latitude `lat`, starting at lon0, at `kmh`,
 * one point every `stepS` seconds, for `durationS` seconds.
 */
export function straightDrive(opts: {
  lat?: number;
  lon0?: number;
  kmh: number;
  durationS: number;
  stepS?: number;
  start?: number;
}): TrackPoint[] {
  const lat = opts.lat ?? 40;
  const lon0 = opts.lon0 ?? 23;
  const step = opts.stepS ?? 5;
  const start = opts.start ?? T0;
  const v = opts.kmh / 3.6;
  const pts: TrackPoint[] = [];
  for (let s = 0; s <= opts.durationS; s += step)
    pts.push({ lat, lon: lon0 + mLon(v * s, lat), t: start + s * 1000 });
  return pts;
}

export function camera(id: string, lat: number, lon: number, extra: Partial<Camera> = {}): Camera {
  return { id, label: `#${id}`, lat, lon, simulated: false, ...extra };
}
