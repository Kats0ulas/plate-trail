import { kml, tcx } from '@tmcw/togeojson';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { haversineM } from '../engine/geo';
import { INPUT_DEFAULTS } from '../engine/params';
import type { TrackPoint } from '../types';

/**
 * GPS history parsing. Runs on the main thread because @tmcw/togeojson needs DOMParser,
 * which Web Workers do not have. Everything heavier happens in the worker afterwards.
 */

export type ParsedFile = { name: string; points: TrackPoint[]; droppedNoTime: number };

export type NormalizeStats = {
  files: number;
  rawPoints: number;
  droppedNoTime: number;
  droppedDuplicates: number;
  droppedGlitches: number;
  droppedDownsample: number;
  kept: number;
};

export class TrackParseError extends Error {}

type DomParserLike = { parseFromString(text: string, type: 'text/xml'): Document };

export function parseTrackFile(
  name: string,
  text: string,
  parser: DomParserLike = new DOMParser(),
): ParsedFile {
  const doc = parser.parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new TrackParseError(`${name}: not valid XML`);
  }
  const root = (doc.documentElement?.localName ?? '').toLowerCase();
  if (root === 'gpx') return { name, ...parseGpxDocument(doc) };
  let fc: FeatureCollection;
  if (root === 'trainingcenterdatabase') fc = tcx(doc) as FeatureCollection;
  else if (root === 'kml') fc = kml(doc) as FeatureCollection;
  else throw new TrackParseError(`${name}: not a GPX, TCX or KML file`);

  const points: TrackPoint[] = [];
  let droppedNoTime = 0;
  for (const f of fc.features) {
    for (const { coords, times } of lines(f)) {
      // togeojson skips missing timestamps instead of leaving a gap, so the two arrays
      // only line up when every point had one. Otherwise we cannot tell which is which.
      if (!times || times.length !== coords.length) {
        droppedNoTime += coords.length;
        continue;
      }
      coords.forEach((c, i) => {
        const raw = times?.[i];
        const t = typeof raw === 'string' ? Date.parse(raw) : typeof raw === 'number' ? raw : NaN;
        const lon = c[0];
        const lat = c[1];
        if (lat === undefined || lon === undefined || !Number.isFinite(lat + lon)) return;
        if (!Number.isFinite(t)) {
          droppedNoTime++;
          return;
        }
        points.push({ lat, lon, t });
      });
    }
  }
  return { name, points, droppedNoTime };
}

/**
 * GPX is read directly rather than through togeojson: togeojson drops missing <time>
 * elements without leaving a gap, which shifts every later timestamp onto the wrong point.
 */
function parseGpxDocument(doc: Document): { points: TrackPoint[]; droppedNoTime: number } {
  const points: TrackPoint[] = [];
  let droppedNoTime = 0;
  for (const tag of ['trkpt', 'rtept']) {
    const els = doc.getElementsByTagNameNS('*', tag);
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      const lat = Number(el.getAttribute('lat'));
      const lon = Number(el.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || el.getAttribute('lat') === null)
        continue;
      const timeEl = el.getElementsByTagNameNS('*', 'time')[0];
      const t = timeEl ? Date.parse((timeEl.textContent ?? '').trim()) : NaN;
      if (!Number.isFinite(t)) {
        droppedNoTime++;
        continue;
      }
      points.push({ lat, lon, t });
    }
  }
  return { points, droppedNoTime };
}

/** togeojson puts per-vertex timestamps in properties.coordinateProperties.times (nested for MultiLineString). */
function lines(f: Feature<Geometry | null>): { coords: number[][]; times?: unknown[] }[] {
  const g = f.geometry;
  const times = (f.properties?.coordinateProperties as { times?: unknown[] } | undefined)?.times;
  if (!g) return [];
  if (g.type === 'LineString') return [{ coords: g.coordinates, times }];
  if (g.type === 'MultiLineString') {
    return g.coordinates.map((coords, i) => ({
      coords,
      times: Array.isArray(times?.[i]) ? (times[i] as unknown[]) : undefined,
    }));
  }
  return [];
}

/**
 * Merge several files into one clean, time-ordered track:
 * sort by time, drop duplicates, drop GPS glitches (impossible jumps), thin very dense
 * recordings, and compute speed between consecutive points.
 * The result does not depend on the order the files were given in.
 */
export function normalizeTrack(
  files: readonly ParsedFile[],
  opts: { glitchKmh?: number; minSampleMs?: number } = {},
): { points: TrackPoint[]; stats: NormalizeStats } {
  const glitchKmh = opts.glitchKmh ?? INPUT_DEFAULTS.glitchKmh;
  const minSampleMs = opts.minSampleMs ?? INPUT_DEFAULTS.minSampleMs;

  const all: TrackPoint[] = [];
  let droppedNoTime = 0;
  for (const f of files) {
    droppedNoTime += f.droppedNoTime;
    for (const p of f.points) all.push({ lat: p.lat, lon: p.lon, t: p.t });
  }
  const rawPoints = all.length + droppedNoTime;
  // Full tie-break so shuffled inputs give identical output.
  all.sort((a, b) => a.t - b.t || a.lat - b.lat || a.lon - b.lon);

  // 1. Duplicates: one point per timestamp.
  const unique: TrackPoint[] = [];
  for (const p of all) {
    const last = unique[unique.length - 1];
    if (last && last.t === p.t) continue;
    unique.push(p);
  }
  const droppedDuplicates = all.length - unique.length;

  // 2. Glitches: a single point that jumps away at an impossible speed and back.
  const kmh = (a: TrackPoint, b: TrackPoint) =>
    b.t === a.t ? Infinity : (haversineM(a, b) / ((b.t - a.t) / 1000)) * 3.6;
  const clean: TrackPoint[] = [];
  let droppedGlitches = 0;
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i]!;
    const prev = clean[clean.length - 1];
    if (prev && kmh(prev, p) > glitchKmh) {
      const next = unique[i + 1];
      // Spike: the point after it is reachable from the previous one at a sane speed.
      if (!next || kmh(prev, next) <= glitchKmh) {
        droppedGlitches++;
        continue;
      }
    }
    clean.push(p);
  }

  // 3. Thin dense recordings to at most one point per minSampleMs.
  const thinned: TrackPoint[] = [];
  for (const p of clean) {
    const last = thinned[thinned.length - 1];
    if (last && p.t - last.t < minSampleMs) continue;
    thinned.push(p);
  }
  const droppedDownsample = clean.length - thinned.length;

  // 4. Speed between consecutive points.
  for (let i = 0; i < thinned.length; i++) {
    const p = thinned[i]!;
    const prev = thinned[i - 1];
    p.speedKmh = prev ? round1(kmh(prev, p)) : 0;
  }

  return {
    points: thinned,
    stats: {
      files: files.length,
      rawPoints,
      droppedNoTime,
      droppedDuplicates,
      droppedGlitches,
      droppedDownsample,
      kept: thinned.length,
    },
  };
}

function round1(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}
