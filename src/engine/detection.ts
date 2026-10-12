import Flatbush from 'flatbush';
import type { Camera, Detection, TrackPoint } from '../types';
import { angleDiffDeg, bearingDeg, closestApproach, haversineM, radiusToDegrees } from './geo';
import type { DetectionParams } from './params';

/**
 * What the camera network records: for each pair of consecutive GPS points, every camera
 * within R of that segment "reads" the plate at the interpolated moment of closest approach.
 */

export type CameraIndex = { cameras: readonly Camera[]; index: Flatbush | null };

export function buildCameraIndex(cameras: readonly Camera[]): CameraIndex {
  if (cameras.length === 0) return { cameras, index: null }; // Flatbush needs ≥ 1 item
  const index = new Flatbush(cameras.length);
  for (const c of cameras) index.add(c.lon, c.lat, c.lon, c.lat);
  index.finish();
  return { cameras, index };
}

function facesHeading(cam: Camera, headingDeg: number, toleranceDeg: number): boolean {
  if (!cam.directions?.length) return true; // unknown facing: assume it can read either way
  return cam.directions.some(
    (d) =>
      angleDiffDeg(headingDeg, d) <= toleranceDeg ||
      angleDiffDeg(headingDeg, d + 180) <= toleranceDeg,
  );
}

export function detect(
  track: readonly TrackPoint[],
  camerasOrIndex: readonly Camera[] | CameraIndex,
  params: DetectionParams,
): Detection[] {
  const { cameras, index } = Array.isArray(camerasOrIndex)
    ? buildCameraIndex(camerasOrIndex as readonly Camera[])
    : (camerasOrIndex as CameraIndex);
  if (!index || track.length < 2) return [];

  const R = params.radiusM;
  const raw: (Detection & { distanceM: number })[] = [];
  let lastHeading = 0;

  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]!;
    const b = track[i]!;
    const dt = b.t - a.t;
    if (dt <= 0 || dt > params.maxSegmentGapMs) continue;
    const distM = haversineM(a, b);
    const speedKmh = (distM / (dt / 1000)) * 3.6;
    if (params.vehicleOnly && (speedKmh < params.minVehicleKmh || speedKmh > params.maxVehicleKmh))
      continue;

    const { dLat, dLon } = radiusToDegrees(Math.max(Math.abs(a.lat), Math.abs(b.lat)), R);
    const hits = index.search(
      Math.min(a.lon, b.lon) - dLon,
      Math.min(a.lat, b.lat) - dLat,
      Math.max(a.lon, b.lon) + dLon,
      Math.max(a.lat, b.lat) + dLat,
    );
    if (hits.length === 0) continue;
    const heading = distM >= 1 ? bearingDeg(a, b) : lastHeading;
    lastHeading = heading;

    for (const h of hits) {
      const cam = cameras[h]!;
      const { distanceM, u } = closestApproach(cam, a, b);
      if (distanceM > R) continue;
      if (params.directionFilter && !facesHeading(cam, heading, params.directionToleranceDeg))
        continue;
      const t = Math.round(a.t + u * dt);
      raw.push({
        id: `${cam.id}@${t}`,
        cameraId: cam.id,
        t,
        lat: cam.lat,
        lon: cam.lon,
        headingDeg: Math.round(heading),
        speedKmh: Math.round(speedKmh),
        simulated: cam.simulated,
        distanceM,
      });
    }
  }

  // One pass by a camera often touches two or three consecutive segments. All hits on the
  // same camera within dedupeMs of the first are one read, placed at the closest approach.
  raw.sort((x, y) => x.t - y.t || (x.cameraId < y.cameraId ? -1 : x.cameraId > y.cameraId ? 1 : 0));
  const open = new Map<string, { firstT: number; best: (typeof raw)[number] }>();
  const out: Detection[] = [];
  const flush = (g: { best: (typeof raw)[number] }) => {
    const { distanceM: _d, ...d } = g.best;
    out.push(d);
  };
  for (const d of raw) {
    const g = open.get(d.cameraId);
    if (g && d.t - g.firstT < params.dedupeMs) {
      if (d.distanceM < g.best.distanceM) g.best = d;
      continue;
    }
    if (g) flush(g);
    open.set(d.cameraId, { firstT: d.t, best: d });
  }
  for (const g of open.values()) flush(g);
  out.sort((x, y) => x.t - y.t || (x.cameraId < y.cameraId ? -1 : x.cameraId > y.cameraId ? 1 : 0));
  return out;
}
