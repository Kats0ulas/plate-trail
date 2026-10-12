import { clustersDbscan } from '@turf/clusters-dbscan';
import { featureCollection, point } from '@turf/helpers';
import type { Confidence, Place, PlaceLabel } from '../types';
import { haversineM, weightedCentroid } from './geo';
import type { LabelingParams } from './params';
import {
  DAY,
  MINUTE,
  WEEKDAY_SHORT,
  formatClock,
  formatDateTime,
  formatDuration,
  localMidnight,
  localTime,
} from './time';

/**
 * Shared rules that turn "stays" into Home / Work / Recurring place / Rare visit.
 * The observer (camera reads only) and the ground truth (full GPS track) both use this
 * exact code, so the comparison between them is fair. Nothing here knows where the
 * stays came from beyond the optional camera labels used in explanations.
 */

export type Visit = {
  lat: number;
  lon: number;
  /** How well the location of this one stay is known, metres. */
  radiusM: number;
  arrive: number;
  depart: number;
  /** Observer only: the cameras whose reads bracket this stay (for explanations). */
  cameraLabels?: [string, string];
};

export type VisitCluster = {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  visits: Visit[];
};

export type Kind = 'observer' | 'truth';

export type LabelContext = { timeZone: string; kind: Kind; params: LabelingParams };

export type Labelled = { places: Place[]; clusterLabels: Map<string, PlaceLabel> };

const dwell = (v: Visit) => Math.max(0, v.depart - v.arrive);

// Clustering

/**
 * DBSCAN (@turf/clusters-dbscan) over stay locations. Stays that belong to no cluster
 * become single-stay clusters of their own: they are the candidates for rare visits.
 */
export function clusterVisits(
  visits: readonly Visit[],
  epsM: number,
  minPoints: number,
  minRadiusM: number,
  kind: Kind,
): VisitCluster[] {
  if (visits.length === 0) return [];
  const fc = featureCollection(visits.map((v, i) => point([v.lon, v.lat], { i })));
  const clustered = clustersDbscan(fc, epsM, { units: 'meters', minPoints });
  const groups = new Map<string, Visit[]>();
  for (const f of clustered.features) {
    const i = (f.properties as { i: number }).i;
    const c = f.properties.cluster;
    const key = c === undefined ? `noise-${i}` : `c-${c}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(visits[i]!);
  }
  const out: VisitCluster[] = [];
  for (const vs of groups.values()) {
    vs.sort((a, b) => a.arrive - b.arrive);
    const weights = vs.map((v) => Math.max(dwell(v), MINUTE));
    const center = weightedCentroid(vs, weights);
    const wSum = weights.reduce((s, w) => s + w, 0);
    const spread = Math.sqrt(
      vs.reduce((s, v, i) => s + weights[i]! * haversineM(center, v) ** 2, 0) / wSum,
    );
    let radiusM: number;
    if (kind === 'observer') {
      const meanUnc = vs.reduce((s, v, i) => s + weights[i]! * v.radiusM, 0) / wSum;
      const evidencePairs = new Set(vs.map((v) => v.cameraLabels?.join('|') ?? '')).size;
      radiusM = Math.max(
        minRadiusM,
        Math.sqrt(spread ** 2 + (meanUnc / Math.sqrt(evidencePairs)) ** 2),
      );
    } else {
      radiusM = Math.max(minRadiusM, spread);
    }
    out.push({
      id: '',
      lat: center.lat,
      lon: center.lon,
      radiusM: Math.round(radiusM),
      visits: vs,
    });
  }
  // Stable ids: order by first arrival.
  out.sort((a, b) => a.visits[0]!.arrive - b.visits[0]!.arrive || a.lat - b.lat);
  out.forEach((c, i) => (c.id = `${kind}-${i}`));
  return out;
}

// Time windows

type DayOverlap = { ms: number; days: Map<string, number> };

/** Time spent inside a daily local window [startMin, endMin), optionally weekdays only. */
export function dailyWindowOverlap(
  visits: readonly Visit[],
  startMin: number,
  endMin: number,
  timeZone: string,
  weekdaysOnly = false,
): DayOverlap {
  const days = new Map<string, number>();
  let total = 0;
  for (const v of visits) {
    let ds = localMidnight(v.arrive, timeZone);
    while (ds < v.depart) {
      const lt = localTime(ds + MINUTE, timeZone);
      if (!weekdaysOnly || lt.weekday <= 4) {
        const ws = ds + startMin * MINUTE;
        const we = ds + endMin * MINUTE;
        const o = Math.min(we, v.depart) - Math.max(ws, v.arrive);
        if (o > 0) {
          total += o;
          days.set(lt.dayKey, (days.get(lt.dayKey) ?? 0) + o);
        }
      }
      ds = localMidnight(ds + DAY + 2 * 3_600_000, timeZone);
    }
  }
  return { ms: total, days };
}

function confidenceOf(
  days: number,
  dwellMs: number,
  radiusM: number,
  p: LabelingParams,
): Confidence {
  if (days >= p.highMinDays && radiusM <= p.highMaxRadiusM) return 'High';
  if ((days >= p.mediumMinDays || dwellMs >= p.mediumMinDwellMs) && radiusM <= p.mediumMaxRadiusM)
    return 'Medium';
  return 'Low';
}

const distinctDays = (vs: readonly Visit[], tz: string) =>
  new Set(vs.map((v) => localTime(v.arrive, tz).dayKey)).size;

function camerasPhrase(labels: string[]): string {
  const uniq = [...new Set(labels)].slice(0, 3);
  if (!uniq.length) return '';
  return ` (camera${uniq.length > 1 ? 's' : ''} ${uniq.join(', ')})`;
}

function clockRange(mins: number[]): string {
  if (!mins.length) return '';
  const lo = Math.min(...mins);
  const hi = Math.max(...mins);
  return Math.round(hi) - Math.round(lo) < 2
    ? `at ${formatClock(lo)}`
    : `between ${formatClock(lo)} and ${formatClock(hi)}`;
}

function circularMean(mins: number[]): number {
  let x = 0;
  let y = 0;
  for (const m of mins) {
    x += Math.cos((m / 1440) * 2 * Math.PI);
    y += Math.sin((m / 1440) * 2 * Math.PI);
  }
  return ((Math.atan2(y, x) / (2 * Math.PI)) * 1440 + 1440) % 1440;
}
const circDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1440;
  return d > 720 ? 1440 - d : d;
};

// Labelling

export function labelPlaces(clusters: readonly VisitCluster[], ctx: LabelContext): Labelled {
  const { timeZone: tz, kind, params: p } = ctx;
  const places: Place[] = [];
  const clusterLabels = new Map<string, PlaceLabel>();
  const taken = new Set<string>();
  const obs = kind === 'observer';

  const base = (c: VisitCluster, label: PlaceLabel, days: number, evidence: string[]): Place => {
    const total = c.visits.reduce((s, v) => s + dwell(v), 0);
    return {
      id: `${kind}-${label}-${c.id}`,
      label,
      lat: c.lat,
      lon: c.lon,
      radiusM: c.radiusM,
      confidence: confidenceOf(days, total, c.radiusM, p),
      days,
      visits: c.visits.length,
      totalDwellMs: total,
      evidence,
      firstSeen: c.visits[0]!.arrive,
      lastSeen: c.visits[c.visits.length - 1]!.depart,
    };
  };

  // Home: most time overlapping the local night window.
  let home: { c: VisitCluster; o: DayOverlap } | null = null;
  for (const c of clusters) {
    const o = dailyWindowOverlap(c.visits, p.nightStartMin, p.nightEndMin, tz);
    if (o.ms > 0 && (!home || o.ms > home.o.ms)) home = { c, o };
  }
  if (home) {
    const { c, o } = home;
    const nights = o.days.size;
    const evidence: string[] = [];
    const mornings = c.visits.filter((v) => {
      const lt = localTime(v.depart, tz);
      return lt.weekday <= 4 && lt.minutes >= 4 * 60 && lt.minutes <= 13 * 60;
    });
    const evenings = c.visits.filter((v) => localTime(v.arrive, tz).minutes >= 15 * 60);
    if (obs) {
      evidence.push(
        `The car went quiet near here on ${nights} night${nights === 1 ? '' : 's'}: the last read of the evening and the first read of the next morning were both close by.`,
      );
      if (mornings.length) {
        evidence.push(
          `Seen leaving this area on ${mornings.length} weekday morning${mornings.length === 1 ? '' : 's'} ${clockRange(mornings.map((v) => localTime(v.depart, tz).minutes))}${camerasPhrase(mornings.map((v) => v.cameraLabels?.[1] ?? '').filter(Boolean))}.`,
        );
      }
      if (evenings.length)
        evidence.push(
          `Last read of the day was near here on ${distinctDays(evenings, tz)} evening${distinctDays(evenings, tz) === 1 ? '' : 's'}${camerasPhrase(evenings.map((v) => v.cameraLabels?.[0] ?? '').filter(Boolean))}.`,
        );
    } else {
      evidence.push(
        `Your GPS stayed here on ${nights} night${nights === 1 ? '' : 's'} (between midnight and 6 am).`,
      );
      if (mornings.length)
        evidence.push(
          `You left on ${mornings.length} weekday morning${mornings.length === 1 ? '' : 's'} ${clockRange(mornings.map((v) => localTime(v.depart, tz).minutes))}.`,
        );
    }
    places.push(base(c, 'home', nights, evidence));
    clusterLabels.set(c.id, 'home');
    taken.add(c.id);
  }

  // Work: most weekday time inside working hours, on enough different days.
  let work: { c: VisitCluster; o: DayOverlap; days: string[] } | null = null;
  for (const c of clusters) {
    if (taken.has(c.id)) continue;
    const o = dailyWindowOverlap(c.visits, p.workStartMin, p.workEndMin, tz, true);
    const days = [...o.days].filter(([, ms]) => ms >= p.workMinDailyMs).map(([k]) => k);
    if (days.length >= p.workMinDays && (!work || o.ms > work.o.ms)) work = { c, o, days };
  }
  if (work) {
    const { c, days } = work;
    const arrivals = c.visits
      .filter((v) => localTime(v.arrive, tz).weekday <= 4)
      .map((v) => localTime(v.arrive, tz).minutes);
    const departures = c.visits
      .filter((v) => localTime(v.depart, tz).weekday <= 4)
      .map((v) => localTime(v.depart, tz).minutes);
    const evidence = [
      `${obs ? 'The car stayed near here' : 'You were here'} through working hours on ${days.length} weekday${days.length === 1 ? '' : 's'}.`,
    ];
    if (arrivals.length && departures.length) {
      evidence.push(
        `${obs ? 'Reads place the arrival' : 'Arrival was'} typically around ${formatClock(circularMean(arrivals))} and departure around ${formatClock(circularMean(departures))}${obs ? camerasPhrase(c.visits.map((v) => v.cameraLabels?.[0] ?? '').filter(Boolean)) : ''}.`,
      );
    }
    const place = base(c, 'work', days.length, evidence);
    place.typicalArrivalMin = arrivals.length ? circularMean(arrivals) : undefined;
    places.push(place);
    clusterLabels.set(c.id, 'work');
    taken.add(c.id);
  }

  // Recurring: medium-length stays on ≥ N days at similar times of day.
  const recurring: Place[] = [];
  for (const c of clusters) {
    if (taken.has(c.id)) continue;
    const candidates = c.visits.filter(
      (v) => dwell(v) >= p.recurringMinMs && dwell(v) <= p.recurringMaxMs,
    );
    if (candidates.length < p.recurringMinDays) continue;
    let best: Visit[] = [];
    for (const anchor of candidates) {
      const a = localTime(anchor.arrive, tz).minutes;
      const group = candidates.filter(
        (v) => circDiff(localTime(v.arrive, tz).minutes, a) <= p.recurringTimeToleranceMin,
      );
      const nd = distinctDays(group, tz);
      if (nd > distinctDays(best, tz)) best = group;
    }
    const nd = distinctDays(best, tz);
    if (nd < p.recurringMinDays) continue;
    const arr = best.map((v) => localTime(v.arrive, tz).minutes);
    const mean = circularMean(arr);
    const sd = Math.sqrt(arr.reduce((s, m) => s + circDiff(m, mean) ** 2, 0) / arr.length);
    const weekdays = [...new Set(best.map((v) => localTime(v.arrive, tz).weekday))]
      .sort()
      .map((w) => WEEKDAY_SHORT[w]);
    const durs = best.map(dwell);
    const evidence = [
      `${best.length} stay${best.length === 1 ? '' : 's'} of ${formatDuration(Math.min(...durs))} to ${formatDuration(Math.max(...durs))} on ${nd} different days.`,
      `${obs ? 'Reads suggest arrival' : 'Arrival'} around ${formatClock(mean)} (± ${Math.round(sd)} min), on ${weekdays.join(', ')}${obs ? camerasPhrase(best.map((v) => v.cameraLabels?.[0] ?? '').filter(Boolean)) : ''}.`,
    ];
    const place = base(c, 'recurring', nd, evidence);
    place.typicalArrivalMin = mean;
    recurring.push(place);
    clusterLabels.set(c.id, 'recurring');
    taken.add(c.id);
  }
  recurring.sort((a, b) => b.days - a.days || b.totalDwellMs - a.totalDwellMs);
  places.push(...recurring);

  // Rare: a single long stay at a place never visited otherwise.
  for (const c of clusters) {
    if (taken.has(c.id) || c.visits.length !== 1) continue;
    const v = c.visits[0]!;
    if (dwell(v) <= p.rareMinMs) continue;
    const evidence = [
      `A single stay of ${formatDuration(dwell(v))}: ${formatDateTime(v.arrive, tz)} → ${formatDateTime(v.depart, tz)}. No other visit nearby.`,
    ];
    if (obs && v.cameraLabels)
      evidence.push(
        `Bracketed by a read at camera ${v.cameraLabels[0]} and the next read, at camera ${v.cameraLabels[1]}.`,
      );
    const place = base(c, 'rare', 1, evidence);
    place.typicalArrivalMin = localTime(v.arrive, tz).minutes;
    places.push(place);
    clusterLabels.set(c.id, 'rare');
    taken.add(c.id);
  }

  return { places, clusterLabels };
}
