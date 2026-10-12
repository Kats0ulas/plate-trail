/**
 * Ground truth: what the person actually did, computed from the FULL GPS track.
 * Used only to grade the observer ("Reveal the truth"). Uses the same labelling rules.
 */
import type { InferenceResult, TrackPoint } from '../types';
import { haversineM, weightedCentroid } from './geo';
import { type Visit, clusterVisits, labelPlaces } from './labeling';
import type { GroundTruthParams, LabelingParams, ScheduleParams } from './params';
import { buildSchedule } from './schedule';
import { localTime } from './time';

/**
 * Classic stay-point detection: from point i, extend j while every point stays within
 * stayRadiusM of point i; if that span lasts ≥ stayMinMs it is a stay point.
 */
export function detectStayPoints(track: readonly TrackPoint[], params: GroundTruthParams): Visit[] {
  const stays: Visit[] = [];
  const n = track.length;
  let i = 0;
  while (i < n) {
    const pi = track[i]!;
    let j = i + 1;
    while (j < n && haversineM(pi, track[j]!) <= params.stayRadiusM) j++;
    const last = track[j - 1]!;
    if (j - 1 > i && last.t - pi.t >= params.stayMinMs) {
      const c = weightedCentroid(track.slice(i, j));
      stays.push({ lat: c.lat, lon: c.lon, radiusM: 0, arrive: pi.t, depart: last.t });
      i = j;
    } else {
      i++;
    }
  }
  return stays;
}

export function groundTruthFromTrack(
  track: readonly TrackPoint[],
  params: { groundTruth: GroundTruthParams; labeling: LabelingParams; schedule: ScheduleParams },
  timeZone: string,
): InferenceResult {
  const stays = detectStayPoints(track, params.groundTruth);
  const clusters = clusterVisits(
    stays,
    params.groundTruth.clusterEpsM,
    params.groundTruth.clusterMinPoints,
    50,
    'truth',
  );
  const { places, clusterLabels } = labelPlaces(clusters, {
    timeZone,
    kind: 'truth',
    params: params.labeling,
  });
  const visitsOf = (label: string) =>
    clusters.filter((c) => clusterLabels.get(c.id) === label).flatMap((c) => c.visits);
  const schedule = buildSchedule(
    visitsOf('home'),
    visitsOf('work'),
    timeZone,
    params.schedule,
    'truth',
  );
  return {
    places,
    schedule,
    stats: {
      reads: 0,
      distinctCameras: 0,
      daysCovered: new Set(track.map((p) => localTime(p.t, timeZone).dayKey)).size,
      trips: 0,
      stays: stays.length,
    },
  };
}
