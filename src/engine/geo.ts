/** Small, fast geodesy helpers. Accurate to well under a metre at city scale. */

export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export type LatLon = { lat: number; lon: number };

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north, 0 to 360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Smallest absolute difference between two angles, 0 to 180. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Metres per degree of latitude / longitude around a given latitude. */
export function metresPerDegree(lat: number): { mLat: number; mLon: number } {
  const mLat = EARTH_RADIUS_M * RAD;
  return { mLat, mLon: mLat * Math.cos(lat * RAD) };
}

/** Expand a point to a bounding box of ±radius metres, in degrees. */
export function radiusToDegrees(lat: number, radiusM: number): { dLat: number; dLon: number } {
  const { mLat, mLon } = metresPerDegree(lat);
  return { dLat: radiusM / mLat, dLon: radiusM / Math.max(mLon, 1e-9) };
}

/**
 * Closest approach of point P to segment AB, in a local flat projection around P.
 * Returns the distance in metres and u ∈ [0, 1], the fraction along AB of the closest point.
 */
export function closestApproach(p: LatLon, a: LatLon, b: LatLon): { distanceM: number; u: number } {
  const { mLat, mLon } = metresPerDegree(p.lat);
  const ax = (a.lon - p.lon) * mLon;
  const ay = (a.lat - p.lat) * mLat;
  const bx = (b.lon - p.lon) * mLon;
  const by = (b.lat - p.lat) * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  u = Math.max(0, Math.min(1, u));
  const cx = ax + u * dx;
  const cy = ay + u * dy;
  return { distanceM: Math.hypot(cx, cy), u };
}

/** Weighted mean position (plain mean when no weights). Fine for points a few km apart. */
export function weightedCentroid(points: readonly LatLon[], weights?: readonly number[]): LatLon {
  let sw = 0;
  let lat = 0;
  let lon = 0;
  points.forEach((p, i) => {
    const w = weights?.[i] ?? 1;
    sw += w;
    lat += p.lat * w;
    lon += p.lon * w;
  });
  if (sw === 0) return { lat: points[0]?.lat ?? 0, lon: points[0]?.lon ?? 0 };
  return { lat: lat / sw, lon: lon / sw };
}

/** Midpoint of two nearby points. */
export function midpoint(a: LatLon, b: LatLon): LatLon {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}
