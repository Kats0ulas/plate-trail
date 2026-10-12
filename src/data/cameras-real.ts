import type { Camera } from '../types';
import {
  CellCache,
  alprQuery,
  cellKey,
  overpassFetch,
  type OverpassOptions,
  type OverpassResponse,
} from './overpass';
import { OVERPASS_DEFAULTS } from '../engine/params';

/** Real ALPRs mapped in OpenStreetMap (`surveillance:type=ALPR`). */

const CARDINAL: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
}; // prettier-ignore

/** Parse OSM `direction` / `camera:direction`: "90", "45;225", "NE", "90-180" (→ middle). */
export function parseDirection(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const out: number[] = [];
  for (const part of raw.split(';')) {
    const s = part.trim().toUpperCase();
    if (!s) continue;
    if (s in CARDINAL) {
      out.push(CARDINAL[s]!);
      continue;
    }
    const range = /^(-?\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(s);
    if (range) {
      const a = Number(range[1]);
      let b = Number(range[2]);
      if (b < a) b += 360;
      out.push(((((a + b) / 2) % 360) + 360) % 360);
      continue;
    }
    const n = Number(s);
    if (Number.isFinite(n)) out.push(((n % 360) + 360) % 360);
  }
  return out.length ? out : undefined;
}

/** Overpass returns OSM JSON, not GeoJSON: nodes have lat/lon, ways have a `center`. */
export function camerasFromOverpass(resp: OverpassResponse): Camera[] {
  const cams: Camera[] = [];
  for (const el of resp.elements) {
    const pos =
      el.type === 'node' && el.lat !== undefined && el.lon !== undefined
        ? { lat: el.lat, lon: el.lon }
        : el.center;
    if (!pos) continue;
    const tags = el.tags ?? {};
    if (tags['surveillance:type'] !== 'ALPR') continue;
    const cam: Camera = {
      id: `osm-${el.type}-${el.id}`,
      label: '',
      lat: pos.lat,
      lon: pos.lon,
      simulated: false,
    };
    const dir = parseDirection(tags['camera:direction'] ?? tags['direction']);
    if (dir) cam.directions = dir;
    if (tags['manufacturer']) cam.manufacturer = tags['manufacturer'];
    if (tags['operator']) cam.operator = tags['operator'];
    if (tags['surveillance:zone']) cam.zone = tags['surveillance:zone'];
    cams.push(cam);
  }
  return labelCameras(cams, '#');
}

/** Stable short labels (#1, #2…) ordered by id, so explanations can name cameras. */
export function labelCameras(cams: Camera[], prefix: string): Camera[] {
  const sorted = [...cams].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sorted.forEach((c, i) => (c.label = `${prefix}${i + 1}`));
  return sorted;
}

const cache = new CellCache<Camera>();

/** Fetch real cameras for the given coarse cells, using the per-cell memory cache. */
export async function loadRealCameras(
  cells: readonly string[],
  opts: OverpassOptions = {},
  cellDeg = OVERPASS_DEFAULTS.cellDeg,
): Promise<Camera[]> {
  const missing = cache.missing(cells);
  if (missing.length) {
    const resp = await overpassFetch(alprQuery(missing, cellDeg), opts);
    const byCell = new Map<string, Camera[]>(missing.map((c) => [c, []]));
    for (const cam of camerasFromOverpass(resp))
      byCell.get(cellKey(cam.lat, cam.lon, cellDeg))?.push(cam);
    for (const [c, list] of byCell) cache.put(c, list);
  }
  const seen = new Set<string>();
  const all = cache.collect(cells).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return labelCameras(
    all.map((c) => ({ ...c })),
    '#',
  );
}
