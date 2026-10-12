import { OVERPASS_DEFAULTS } from '../engine/params';

/**
 * Overpass API client. Privacy rule: queries never contain the track's exact extent.
 * We snap to a coarse grid (0.1° ≈ 10 km cells), ask for every cell the track touches
 * plus its neighbours, all in one request, so the server only learns the rough area.
 */

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  nodes?: number[];
};
export type OverpassResponse = { elements: OverpassElement[]; remark?: string };

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly kind: 'busy' | 'network' | 'bad-response' | 'aborted',
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- coarse cells

/** Cell key "i,j" where i = floor(lat / cellDeg), j = floor(lon / cellDeg). */
export function cellKey(lat: number, lon: number, cellDeg = OVERPASS_DEFAULTS.cellDeg): string {
  return `${Math.floor(lat / cellDeg)},${Math.floor(lon / cellDeg)}`;
}

/** Every cell the points touch, plus the 8 neighbours of each, sorted. */
export function cellsForPoints(
  points: readonly { lat: number; lon: number }[],
  cellDeg = OVERPASS_DEFAULTS.cellDeg,
): string[] {
  const touched = new Set<string>();
  for (const p of points) touched.add(cellKey(p.lat, p.lon, cellDeg));
  const out = new Set<string>();
  for (const k of touched) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) out.add(`${i + di},${j + dj}`);
  }
  return [...out].sort(compareCells);
}

function compareCells(a: string, b: string): number {
  const [ai, aj] = a.split(',').map(Number) as [number, number];
  const [bi, bj] = b.split(',').map(Number) as [number, number];
  return ai - bi || aj - bj;
}

/** [south, west, north, east] of a cell, rounded so queries contain clean grid numbers. */
export function cellBbox(
  key: string,
  cellDeg = OVERPASS_DEFAULTS.cellDeg,
): [number, number, number, number] {
  const [i, j] = key.split(',').map(Number) as [number, number];
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return [r(i * cellDeg), r(j * cellDeg), r((i + 1) * cellDeg), r((j + 1) * cellDeg)];
}

const bboxStr = (key: string, cellDeg: number) => cellBbox(key, cellDeg).join(',');

export function alprQuery(cells: readonly string[], cellDeg = OVERPASS_DEFAULTS.cellDeg): string {
  const clauses = cells
    .map((c) => {
      const b = bboxStr(c, cellDeg);
      return `  node["surveillance:type"="ALPR"](${b});\n  way["surveillance:type"="ALPR"](${b});`;
    })
    .join('\n');
  return `[out:json][timeout:25];\n(\n${clauses}\n);\nout center;`;
}

export function roadsQuery(cells: readonly string[], cellDeg = OVERPASS_DEFAULTS.cellDeg): string {
  const clauses = cells
    .map(
      (c) =>
        `  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bboxStr(c, cellDeg)});`,
    )
    .join('\n');
  return `[out:json][timeout:60];\n(\n${clauses}\n);\nout body;\n>;\nout skel qt;`;
}

// ---------------------------------------------------------------- fetching

/** Wait a little longer than the query's own server-side [timeout:N], then move to the next server. */
export function clientTimeoutMs(query: string): number {
  const n = Number(/[timeout:(d+)]/.exec(query)?.[1] ?? 60);
  return (n + 10) * 1000;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OverpassOptions = {
  endpoints?: readonly string[];
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  /** Attempts per endpoint before moving to the next one. */
  attempts?: number;
  /** Base backoff; doubles each attempt. */
  backoffMs?: number;
  onStatus?: (message: string) => void;
  /** Node scripts can identify themselves; browsers cannot set this header. */
  userAgent?: string;
  /** Give up on one request after this long and try again / elsewhere. */
  timeoutMs?: number;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new OverpassError('Cancelled', 'aborted'));
    });
  });

/**
 * POST a query (form-encoded `data=`). 429/503/504 and Overpass "runtime error" remarks are
 * retried with exponential backoff, then the next endpoint is tried.
 */
export async function overpassFetch(
  query: string,
  opts: OverpassOptions = {},
): Promise<OverpassResponse> {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const attempts = opts.attempts ?? 2;
  const backoffMs = opts.backoffMs ?? 1500;
  let lastProblem = 'no endpoints configured';

  for (const endpoint of endpoints) {
    const host = new URL(endpoint).host;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (opts.signal?.aborted) throw new OverpassError('Cancelled', 'aborted');
      let res: Response;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? clientTimeoutMs(query));
      const onAbort = () => timeout.abort();
      opts.signal?.addEventListener('abort', onAbort);
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        };
        if (opts.userAgent) headers['User-Agent'] = opts.userAgent;
        res = await fetchImpl(endpoint, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers,
          signal: timeout.signal,
          referrerPolicy: 'no-referrer',
          credentials: 'omit',
        });
      } catch (e) {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (opts.signal?.aborted) throw new OverpassError('Cancelled', 'aborted');
        lastProblem = timeout.signal.aborted
          ? `${host} did not answer in time`
          : `${host} unreachable (${(e as Error).message})`;
        break; // network failure or timeout: next endpoint
      }
      if (!res.ok) {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      if (res.status === 429) {
        // Rate limited: wait, then try this server again.
        lastProblem = `${host} asked us to slow down (HTTP 429)`;
        opts.onStatus?.(`${lastProblem}, waiting…`);
        await sleep(backoffMs * 2 ** attempt, opts.signal);
        continue;
      }
      if (res.status === 503 || res.status === 504) {
        // Overloaded: another server is the better bet.
        lastProblem = `${host} is overloaded (HTTP ${res.status})`;
        opts.onStatus?.(`${lastProblem}…`);
        break;
      }
      if (!res.ok) {
        lastProblem = `${host} answered HTTP ${res.status}`;
        break;
      }
      let json: OverpassResponse;
      try {
        json = (await res.json()) as OverpassResponse;
      } catch {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (opts.signal?.aborted) throw new OverpassError('Cancelled', 'aborted');
        lastProblem = `${host} sent something that is not JSON (probably overloaded)`;
        opts.onStatus?.(`${lastProblem}, retrying…`);
        await sleep(backoffMs * 2 ** attempt, opts.signal);
        continue;
      }
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (json.remark && /runtime error|timed out|out of memory|too busy/i.test(json.remark)) {
        lastProblem = `${host}: ${json.remark.slice(0, 120)}`;
        opts.onStatus?.(`${host} is overloaded, retrying…`);
        await sleep(backoffMs * 2 ** attempt, opts.signal);
        continue;
      }
      if (!Array.isArray(json.elements)) {
        lastProblem = `${host} sent an unexpected response`;
        break;
      }
      return json;
    }
    opts.onStatus?.(`Trying another Overpass server…`);
  }
  throw new OverpassError(
    `Could not load OpenStreetMap data: ${lastProblem}. The public Overpass servers are shared and sometimes busy; try again in a minute.`,
    'busy',
  );
}

// ---------------------------------------------------------------- per-cell cache

/**
 * In-memory cache of public data per coarse cell. Only public OSM data goes in here —
 * never anything derived from the user's track beyond which cells were asked for.
 */
export class CellCache<T> {
  private readonly cells = new Map<string, T[]>();

  missing(cells: readonly string[]): string[] {
    return cells.filter((c) => !this.cells.has(c));
  }

  put(cell: string, items: T[]): void {
    this.cells.set(cell, items);
  }

  collect(cells: readonly string[]): T[] {
    const out: T[] = [];
    for (const c of cells) out.push(...(this.cells.get(c) ?? []));
    return out;
  }

  get size(): number {
    return this.cells.size;
  }
}
