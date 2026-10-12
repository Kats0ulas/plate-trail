import { haversineM, radiusToDegrees } from '../engine/geo';
import { OVERPASS_DEFAULTS, SIMULATION_DEFAULTS, type RoadClass } from '../engine/params';
import type { Camera } from '../types';
import {
  CellCache,
  cellKey,
  overpassFetch,
  roadsQuery,
  type OverpassOptions,
  type OverpassResponse,
} from './overpass';

/**
 * Hypothetical cameras: "what if every major junction in my city had one?"
 * A junction is a node shared by ways that belong to *different* roads, so a road that
 * OSM happens to split into two ways does not count.
 */

export type RoadRef = { cls: RoadClass; name?: string; ref?: string };
export type JunctionCandidate = { id: number; lat: number; lon: number; roads: RoadRef[] };
export type RoadWay = { id: number; nodes: number[]; tags: Record<string, string> };

const CLASSES = new Set<string>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

function refsOf(r: RoadRef): string[] {
  return (r.ref ?? '')
    .split(';')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Two ways are the same road if they share a name or a ref (or are both nameless of one class). */
export function sameRoad(a: RoadRef, b: RoadRef): boolean {
  if (a.name && b.name && a.name === b.name) return true;
  const ra = refsOf(a);
  if (ra.length && refsOf(b).some((r) => ra.includes(r))) return true;
  if (!a.name && !a.ref && !b.name && !b.ref) return a.cls === b.cls;
  return false;
}

export function isJunction(roads: readonly RoadRef[], classes?: ReadonlySet<string>): boolean {
  const rs = classes ? roads.filter((r) => classes.has(r.cls)) : roads;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) if (!sameRoad(rs[i]!, rs[j]!)) return true;
  return false;
}

/** Every node shared by ways of different roads (for any class), with the roads that meet there. */
export function findJunctionCandidates(
  ways: readonly RoadWay[],
  nodes: ReadonlyMap<number, { lat: number; lon: number }>,
): JunctionCandidate[] {
  const roadsAt = new Map<number, RoadRef[]>();
  for (const w of ways) {
    const cls = w.tags['highway'];
    if (!cls || !CLASSES.has(cls)) continue;
    const road: RoadRef = { cls: cls as RoadClass };
    if (w.tags['name']) road.name = w.tags['name'];
    if (w.tags['ref']) road.ref = w.tags['ref'];
    for (const n of new Set(w.nodes)) {
      let list = roadsAt.get(n);
      if (!list) roadsAt.set(n, (list = []));
      list.push(road);
    }
  }
  const out: JunctionCandidate[] = [];
  for (const [id, roads] of roadsAt) {
    if (roads.length < 2 || !isJunction(roads)) continue;
    const pos = nodes.get(id);
    if (!pos) continue;
    out.push({ id, lat: pos.lat, lon: pos.lon, roads: dedupeRoads(roads) });
  }
  return out.sort((a, b) => a.id - b.id);
}

function dedupeRoads(roads: RoadRef[]): RoadRef[] {
  const seen = new Set<string>();
  return roads.filter((r) => {
    const k = `${r.cls}|${r.name ?? ''}|${r.ref ?? ''}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function junctionCandidatesFromOverpass(resp: OverpassResponse): JunctionCandidate[] {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways: RoadWay[] = [];
  for (const el of resp.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined)
      nodes.set(el.id, { lat: el.lat, lon: el.lon });
    else if (el.type === 'way' && el.nodes)
      ways.push({ id: el.id, nodes: el.nodes, tags: el.tags ?? {} });
  }
  return findJunctionCandidates(ways, nodes);
}

// Sampling

/** Deterministic hash → [0, 1). Same seed and junction id always give the same number. */
export function seededUnit(seed: number, id: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ id) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = Math.imul(h ^ (id >>> 7) ^ (h >>> 16), 0x9e3779b1) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export type SimulationOptions = {
  roadClasses: readonly RoadClass[];
  /** 0 to 1 */
  coverage: number;
  minSpacingM: number;
  mergeRadiusM: number;
  seed: number;
};

/**
 * Turn junction candidates into hypothetical cameras:
 * keep junctions between the chosen road classes, merge complex intersections (nodes
 * within mergeRadiusM) into one, sample `coverage` of them deterministically, then thin
 * them so no two are closer than minSpacingM.
 */
export function simulateCameras(
  candidates: readonly JunctionCandidate[],
  options: Partial<SimulationOptions> = {},
): Camera[] {
  const o: SimulationOptions = { ...SIMULATION_DEFAULTS, ...options };
  const classes = new Set<string>(o.roadClasses);
  const qualifying = candidates
    .filter((c) => isJunction(c.roads, classes))
    .sort((a, b) => a.id - b.id);

  // Merge nearby junction nodes (union-find over a grid).
  const parent = qualifying.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const grid = new Map<string, number[]>();
  const cellOf = (lat: number, lon: number) => {
    const { dLat, dLon } = radiusToDegrees(lat, Math.max(o.mergeRadiusM, 1));
    return [Math.floor(lat / dLat), Math.floor(lon / dLon)] as const;
  };
  qualifying.forEach((c, i) => {
    const [gy, gx] = cellOf(c.lat, c.lon);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of grid.get(`${gy + dy},${gx + dx}`) ?? []) {
          const other = qualifying[j]!;
          if (haversineM(c, other) <= o.mergeRadiusM) parent[find(i)] = find(j);
        }
    const k = `${gy},${gx}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const groups = new Map<number, JunctionCandidate[]>();
  qualifying.forEach((c, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(c);
  });
  const merged = [...groups.values()].map((g) => ({
    id: Math.min(...g.map((c) => c.id)),
    lat: g.reduce((s, c) => s + c.lat, 0) / g.length,
    lon: g.reduce((s, c) => s + c.lon, 0) / g.length,
    roads: g.flatMap((c) => c.roads),
  }));
  merged.sort((a, b) => a.id - b.id);
  const labelOf = new Map(merged.map((m, i) => [m.id, `S${i + 1}`]));

  // Deterministic sampling, then minimum spacing (lowest hash wins).
  const sampled = merged
    .map((m) => ({ m, u: seededUnit(o.seed, m.id) }))
    .filter(({ u }) => u < o.coverage)
    .sort((a, b) => a.u - b.u);
  const accepted: typeof merged = [];
  const spacingGrid = new Map<string, (typeof merged)[number][]>();
  for (const { m } of sampled) {
    if (o.minSpacingM > 0) {
      const { dLat, dLon } = radiusToDegrees(m.lat, o.minSpacingM);
      const gy = Math.floor(m.lat / dLat);
      const gx = Math.floor(m.lon / dLon);
      let tooClose = false;
      for (let dy = -1; dy <= 1 && !tooClose; dy++)
        for (let dx = -1; dx <= 1 && !tooClose; dx++)
          for (const other of spacingGrid.get(`${gy + dy},${gx + dx}`) ?? [])
            if (haversineM(m, other) < o.minSpacingM) {
              tooClose = true;
              break;
            }
      if (tooClose) continue;
      const k = `${gy},${gx}`;
      (spacingGrid.get(k) ?? spacingGrid.set(k, []).get(k)!).push(m);
    }
    accepted.push(m);
  }
  accepted.sort((a, b) => a.id - b.id);
  return accepted.map((m) => ({
    id: `sim-${m.id}`,
    label: labelOf.get(m.id) ?? `S?`,
    lat: m.lat,
    lon: m.lon,
    simulated: true,
  }));
}

// Loading

const cache = new CellCache<JunctionCandidate>();

/**
 * Fetch major roads for the cells and compute junction candidates per cell.
 * A node's ways all pass through the cell containing that node, so per-cell results are exact.
 */
export async function loadJunctionCandidates(
  cells: readonly string[],
  opts: OverpassOptions = {},
  cellDeg = OVERPASS_DEFAULTS.cellDeg,
): Promise<JunctionCandidate[]> {
  const missing = cache.missing(cells);
  if (missing.length) {
    const resp = await overpassFetch(roadsQuery(missing, cellDeg), opts);
    const byCell = new Map<string, JunctionCandidate[]>(missing.map((c) => [c, []]));
    for (const j of junctionCandidatesFromOverpass(resp))
      byCell.get(cellKey(j.lat, j.lon, cellDeg))?.push(j);
    for (const [c, list] of byCell) cache.put(c, list);
  }
  const seen = new Set<number>();
  return cache.collect(cells).filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

/** Seed the cache from a saved snapshot (used by the demo when Overpass is unavailable). */
export function primeJunctionCache(
  cells: readonly string[],
  list: readonly JunctionCandidate[],
  cellDeg = OVERPASS_DEFAULTS.cellDeg,
): void {
  const byCell = new Map<string, JunctionCandidate[]>(cells.map((c) => [c, []]));
  for (const j of list) byCell.get(cellKey(j.lat, j.lon, cellDeg))?.push(j);
  for (const [c, l] of byCell) cache.put(c, l);
}
