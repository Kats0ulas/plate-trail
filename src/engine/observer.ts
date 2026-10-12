/**
 * The observer: everything an analyst with access to the camera network could infer.
 *
 * It only ever sees Detection[] (plate reads) and Camera[] (public camera positions).
 * It never receives, imports or reaches the raw GPS track. See the eslint rule for this
 * file and tests/observer-isolation.test.ts.
 */
import type { Camera, Detection, InferenceResult } from '../types';
import { haversineM, midpoint } from './geo';
import { type Visit, clusterVisits, labelPlaces } from './labeling';
import type { LabelingParams, ObserverParams, ScheduleParams } from './params';
import { buildSchedule } from './schedule';
import { localTime } from './time';
import { splitTrips } from './trips';

export type ObserverInput = {
  observer: ObserverParams;
  labeling: LabelingParams;
  schedule: ScheduleParams;
};

/**
 * Stay candidates: the silence between the last read of one trip and the first read of the
 * next is a stay somewhere near those two cameras.
 */
export function stayCandidates(
  detections: readonly Detection[],
  cameras: readonly Camera[],
  params: ObserverParams,
): Visit[] {
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const trips = splitTrips(detections, params.tripGapMs);
  const stays: Visit[] = [];
  for (let k = 0; k + 1 < trips.length; k++) {
    const last = trips[k]!.reads[trips[k]!.reads.length - 1]!;
    const next = trips[k + 1]!.reads[0]!;
    const a = { lat: last.lat, lon: last.lon };
    const b = { lat: next.lat, lon: next.lon };
    const uncertainty = Math.max(haversineM(a, b) / 2, params.minStayUncertaintyM);
    if (uncertainty > params.maxStayUncertaintyM) continue;
    const m = midpoint(a, b);
    stays.push({
      lat: m.lat,
      lon: m.lon,
      radiusM: uncertainty,
      arrive: last.t,
      depart: next.t,
      cameraLabels: [byId.get(last.cameraId)?.label ?? '?', byId.get(next.cameraId)?.label ?? '?'],
    });
  }
  return stays;
}

export function inferFromDetections(
  detections: readonly Detection[],
  cameras: readonly Camera[],
  params: ObserverInput,
  timeZone: string,
): InferenceResult {
  const trips = splitTrips(detections, params.observer.tripGapMs);
  const stays = stayCandidates(detections, cameras, params.observer);
  const clusters = clusterVisits(
    stays,
    params.observer.clusterEpsM,
    params.observer.clusterMinPoints,
    params.labeling.minPlaceRadiusM,
    'observer',
  );
  const { places, clusterLabels } = labelPlaces(clusters, {
    timeZone,
    kind: 'observer',
    params: params.labeling,
  });
  const visitsOf = (label: string) =>
    clusters.filter((c) => clusterLabels.get(c.id) === label).flatMap((c) => c.visits);
  const schedule = buildSchedule(
    visitsOf('home'),
    visitsOf('work'),
    timeZone,
    params.schedule,
    'observer',
  );
  return {
    places,
    schedule,
    stats: {
      reads: detections.length,
      distinctCameras: new Set(detections.map((d) => d.cameraId)).size,
      daysCovered: new Set(detections.map((d) => localTime(d.t, timeZone).dayKey)).size,
      trips: trips.length,
      stays: stays.length,
    },
  };
}
