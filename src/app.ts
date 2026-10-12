/**
 * Orchestration: loading a dataset, choosing cameras, and keeping the engine worker's
 * results (reads, inference, comparison) in sync with the controls.
 */
import { RETENTION_PRESETS, presetById } from './config/retention';
import { loadRealCameras, labelCameras } from './data/cameras-real';
import {
  loadJunctionCandidates,
  simulateCameras,
  type JunctionCandidate,
} from './data/cameras-simulated';
import { normalizeTrack, parseTrackFile, TrackParseError, type ParsedFile } from './data/gpx';
import { cellsForPoints, OverpassError } from './data/overpass';
import { Superseded, call } from './engine-client';
import { defaultEngineParams, SCORING_DEFAULTS, type EngineParams } from './engine/params';
import { scorePlaces } from './engine/scoring';
import { setMapTrack } from './map/layers';
import { effectiveTimeZone, store, type AppState } from './state';
import type { Camera, ComparisonRow, Detection, InferenceResult, TrackPoint, Truth } from './types';

export type DemoEntry = {
  slug: string;
  city: string;
  country: string;
  timeZone: string;
  cameraMode: 'real' | 'simulated';
  persona: string;
  blurb: string;
  files: string[];
};

const base = import.meta.env.BASE_URL;
let track: TrackPoint[] = [];
let cells: string[] = [];
let realCache: Camera[] | null = null;
let junctionCache: JunctionCandidate[] | null = null;
let abort: AbortController | null = null;

export function engineParams(s: AppState = store.get()): EngineParams {
  const p = defaultEngineParams();
  p.detection.radiusM = s.radiusM;
  p.detection.vehicleOnly = s.vehicleOnly;
  p.detection.directionFilter = s.directionFilter;
  return p;
}

// ------------------------------------------------------------------ loading data

export async function fetchManifest(): Promise<DemoEntry[]> {
  const res = await fetch(`${base}demo/index.json`);
  if (!res.ok) throw new Error('Could not load the demo list');
  return (await res.json()) as DemoEntry[];
}

export async function loadDemo(slug: string): Promise<void> {
  try {
    store.set({ phase: 'loading', loadingMessage: 'Loading the sample persona…', error: null });
    const entry = (await fetchManifest()).find((d) => d.slug === slug);
    if (!entry) throw new Error(`Unknown demo "${slug}"`);
    const texts = await Promise.all(
      entry.files.map(async (f) => {
        const r = await fetch(`${base}demo/${slug}/${f}`);
        if (!r.ok) throw new Error(`Could not load ${f}`);
        return { name: f, text: await r.text() };
      }),
    );
    const truth = (await (await fetch(`${base}demo/${slug}/truth.json`)).json()) as Truth;
    const parsed = texts.map((t) => parseTrackFile(t.name, t.text));
    const { points, stats } = normalizeTrack(parsed);
    await startDataset(
      points,
      {
        kind: 'demo',
        name: `${entry.city} — synthetic persona`,
        slug,
        persona: entry.persona,
        start: points[0]!.t,
        end: points[points.length - 1]!.t,
        stats,
        timeZone: entry.timeZone,
      },
      entry.cameraMode,
    );
    store.set({ truth: { source: 'persona', places: truth.places } });
  } catch (e) {
    fail(e);
  }
}

export async function loadFiles(files: readonly File[]): Promise<void> {
  try {
    if (!files.length) return;
    store.set({
      phase: 'loading',
      loadingMessage: `Reading ${files.length} file${files.length === 1 ? '' : 's'}…`,
      error: null,
    });
    const parsed: ParsedFile[] = [];
    const problems: string[] = [];
    for (const f of files) {
      try {
        if (f.size > 300 * 1024 * 1024) throw new TrackParseError(`${f.name}: too large`);
        parsed.push(parseTrackFile(f.name, await f.text()));
      } catch (e) {
        problems.push(e instanceof TrackParseError ? e.message : `${f.name}: could not be read`);
      }
    }
    const { points, stats } = normalizeTrack(parsed);
    if (points.length < 2) {
      throw new Error(
        problems.length
          ? `No usable track found. ${problems.join('; ')}`
          : stats.droppedNoTime
            ? `These files have no timestamps (${stats.droppedNoTime} points without time). A replay needs times.`
            : 'No track points found in these files.',
      );
    }
    const notes: string[] = [];
    if (stats.droppedNoTime)
      notes.push(
        `${stats.droppedNoTime.toLocaleString()} points had no timestamp and were skipped`,
      );
    if (stats.droppedGlitches) notes.push(`${stats.droppedGlitches} GPS glitches removed`);
    if (problems.length) notes.push(problems.join('; '));
    await startDataset(
      points,
      {
        kind: 'user',
        name: files.length === 1 ? files[0]!.name : `${parsed.length} files`,
        start: points[0]!.t,
        end: points[points.length - 1]!.t,
        stats,
      },
      'real',
    );
    if (notes.length) store.set({ notice: notes.join(' · ') + '.' });
    // Ground truth from the full track, computed in the worker, only for "Reveal the truth".
    const gt = await call<InferenceResult>({
      type: 'groundTruth',
      timeZone: effectiveTimeZone(),
      params: engineParams(),
    });
    store.set({
      truth: {
        source: 'gps',
        result: gt,
        places: gt.places.map((p) => ({
          id: p.id,
          label: p.label,
          lat: p.lat,
          lon: p.lon,
          name: truthName(p.label, p.days),
        })),
      },
    });
  } catch (e) {
    fail(e);
  }
}

function truthName(label: string, days: number): string {
  const names: Record<string, string> = {
    home: 'Your home',
    work: 'Your workplace',
    recurring: 'A place you return to',
    rare: 'A one-off visit',
  };
  return `${names[label] ?? label} (from your GPS, ${days} day${days === 1 ? '' : 's'})`;
}

async function startDataset(
  points: TrackPoint[],
  dataset: NonNullable<AppState['dataset']>,
  mode: AppState['cameraMode'],
) {
  abort?.abort();
  abort = new AbortController();
  track = points;
  setMapTrack(points);
  cells = cellsForPoints(points);
  realCache = null;
  junctionCache = null;
  store.set({ loadingMessage: 'Handing the track to the engine…' });
  await call({ type: 'setTrack', points });
  store.set({
    phase: 'ready',
    dataset,
    cameraMode: mode,
    T: dataset.end,
    playing: false,
    detections: [],
    inference: null,
    truth: null,
    scores: null,
    comparison: null,
    notice: null,
    cameras: [],
    revealTruth: false,
  });
  await refreshCameras();
}

function fail(e: unknown): void {
  if (e instanceof Superseded) return;
  console.error(e);
  const s = store.get();
  store.set({ phase: s.dataset ? 'ready' : 'landing', error: (e as Error).message ?? String(e) });
}

export function trackPoints(): readonly TrackPoint[] {
  return track;
}

// ------------------------------------------------------------------ cameras

async function snapshot<T>(file: string): Promise<{ fetchedAt: string; data: T } | null> {
  const slug = store.get().dataset?.slug;
  if (!slug) return null;
  try {
    const r = await fetch(`${base}demo/${slug}/${file}`);
    if (!r.ok) return null;
    const j = (await r.json()) as {
      fetchedAt: string;
      cameras?: Camera[];
      junctions?: JunctionCandidate[];
    };
    return { fetchedAt: j.fetchedAt, data: (j.cameras ?? j.junctions) as T };
  } catch {
    return null;
  }
}

/**
 * Get cameras for the current mode. Demos use the bundled OSM snapshot unless `live` is set;
 * uploaded tracks always ask Overpass (coarse cells only).
 */
export async function refreshCameras(live = false): Promise<void> {
  const s = store.get();
  if (!s.dataset) return;
  const isDemo = s.dataset.kind === 'demo';
  const signal = abort?.signal;
  const status = (message: string) =>
    store.set({ cameraStatus: { ...store.get().cameraStatus, state: 'loading', message } });
  try {
    let source: 'live' | 'snapshot' = 'live';
    let fetchedAt: string | undefined;
    if (live) {
      realCache = null;
      junctionCache = null;
    }
    const needReal = s.cameraMode !== 'simulated';
    const needSim = s.cameraMode !== 'real';
    if (needReal && !realCache) {
      const snap = isDemo && !live ? await snapshot<Camera[]>('cameras.json') : null;
      if (snap) {
        realCache = snap.data;
        source = 'snapshot';
        fetchedAt = snap.fetchedAt;
      } else {
        status('Asking OpenStreetMap (Overpass) for mapped ALPR cameras in this area…');
        realCache = await loadRealCameras(cells, { signal, onStatus: status });
      }
    }
    if (needSim && !junctionCache) {
      const snap = isDemo && !live ? await snapshot<JunctionCandidate[]>('junctions.json') : null;
      if (snap) {
        junctionCache = snap.data;
        source = 'snapshot';
        fetchedAt = snap.fetchedAt;
      } else {
        status(
          'Asking OpenStreetMap (Overpass) for major roads to find junctions… this can take a minute.',
        );
        junctionCache = await loadJunctionCandidates(cells, { signal, onStatus: status });
      }
    }
    if (signal?.aborted) return;
    applyCameras(source, fetchedAt);
  } catch (e) {
    if ((e instanceof OverpassError && e.kind === 'aborted') || signal?.aborted) return;
    store.set({
      cameraStatus: {
        state: 'error',
        message: (e as Error).message,
        source: null,
        realCount: 0,
        simulatedCount: 0,
      },
      cameras: [],
      detections: [],
      inference: null,
      comparison: null,
    });
  }
}

/** Rebuild the camera set from the caches (cheap): used when simulated settings change. */
export function applyCameras(source?: 'live' | 'snapshot', fetchedAt?: string): void {
  const s = store.get();
  const real = s.cameraMode !== 'simulated' ? (realCache ?? []) : [];
  const sim =
    s.cameraMode !== 'real'
      ? simulateCameras(junctionCache ?? [], {
          coverage: s.simCoverage / 100,
          minSpacingM: s.simMinSpacingM,
          roadClasses: s.simRoadClasses,
        })
      : [];
  const cameras = [
    ...labelCameras(
      real.map((c) => ({ ...c })),
      '#',
    ),
    ...sim,
  ];
  let message = '';
  if (s.cameraMode !== 'simulated' && real.length === 0)
    message =
      s.cameraMode === 'real'
        ? 'No ALPR cameras are mapped in OpenStreetMap around this track. Try “Simulated” to see what a camera at every major junction would record.'
        : 'No real ALPRs are mapped here; showing hypothetical junction cameras only.';
  else if (s.cameraMode !== 'real' && sim.length === 0 && (junctionCache?.length ?? 0) === 0)
    message = 'No major road junctions found around this track.';
  const prev = s.cameraStatus;
  store.set({
    cameras,
    cameraStatus: {
      state: 'ready',
      message,
      source: source ?? prev.source,
      fetchedAt: fetchedAt ?? prev.fetchedAt,
      realCount: real.length,
      simulatedCount: sim.length,
    },
  });
}

// ------------------------------------------------------------------ engine pipeline

let detectSeq = 0;
async function runDetection(): Promise<void> {
  const s = store.get();
  if (!s.dataset) return;
  const seq = ++detectSeq;
  store.set({ detecting: true });
  try {
    await call({ type: 'setCameras', cameras: s.cameras });
    const detections = await call<Detection[]>({
      type: 'detect',
      params: engineParams().detection,
    });
    if (seq !== detectSeq) return;
    store.set({ detections, detecting: false });
  } catch (e) {
    if (!(e instanceof Superseded)) fail(e);
  }
}

let inferTimer = 0;
let lastInferAt = 0;
function scheduleInference(): void {
  const s = store.get();
  // While playing, refresh a few times a second; otherwise as soon as the cursor settles.
  const wait = s.playing ? Math.max(0, 300 - (performance.now() - lastInferAt)) : 120;
  clearTimeout(inferTimer);
  inferTimer = window.setTimeout(() => void runInference(), wait);
}

async function runInference(): Promise<void> {
  const s = store.get();
  if (!s.dataset || s.cameraStatus.state !== 'ready') return;
  lastInferAt = performance.now();
  try {
    const inference = await call<InferenceResult>({
      type: 'infer',
      T: s.T,
      retentionHours: presetById(s.retentionId).hours,
      timeZone: effectiveTimeZone(s),
      params: engineParams(s),
    });
    store.set({ inference });
    rescore();
  } catch (e) {
    if (!(e instanceof Superseded)) fail(e);
  }
}

function rescore(): void {
  const s = store.get();
  if (!s.inference || !s.truth) return store.set({ scores: null });
  store.set({
    scores: scorePlaces(s.inference.places, s.truth.places, SCORING_DEFAULTS.hitRadiusM),
  });
}

let compareTimer = 0;
function scheduleComparison(): void {
  clearTimeout(compareTimer);
  if (store.get().playing) return;
  compareTimer = window.setTimeout(() => void runComparison(), 450);
}

async function runComparison(): Promise<void> {
  const s = store.get();
  if (!s.dataset || !s.truth || s.cameraStatus.state !== 'ready') return;
  try {
    const rows = await call<ComparisonRow[]>({
      type: 'compare',
      T: s.T,
      presets: RETENTION_PRESETS.map((p) => ({ id: p.id, hours: p.hours })),
      timeZone: effectiveTimeZone(s),
      params: engineParams(s),
      truth: s.truth.places,
      hitRadiusM: SCORING_DEFAULTS.hitRadiusM,
    });
    store.set({ comparison: rows, comparisonT: s.T });
  } catch (e) {
    if (!(e instanceof Superseded)) fail(e);
  }
}

export function wirePipeline(): void {
  store.on(['cameraMode'], (s, p) => {
    if (s.dataset && s.cameraMode !== p.cameraMode) void refreshCameras();
  });
  let simTimer = 0;
  store.on(['simCoverage', 'simMinSpacingM', 'simRoadClasses'], () => {
    clearTimeout(simTimer);
    simTimer = window.setTimeout(() => applyCameras(), 150);
  });
  store.on(['cameras', 'radiusM', 'vehicleOnly', 'directionFilter'], () => void runDetection());
  store.on(['detections', 'T', 'retentionId', 'tzOverride'], scheduleInference);
  store.on(['truth'], rescore);
  store.on(['detections', 'truth', 'tzOverride', 'playing'], scheduleComparison);
  store.on(['T'], (s) => {
    if (!s.playing) scheduleComparison();
  });
  store.on(['tzOverride'], async (s) => {
    if (s.dataset?.kind === 'user' && s.truth?.source === 'gps') {
      const gt = await call<InferenceResult>({
        type: 'groundTruth',
        timeZone: effectiveTimeZone(),
        params: engineParams(),
      });
      store.set({
        truth: {
          source: 'gps',
          result: gt,
          places: gt.places.map((p) => ({
            id: p.id,
            label: p.label,
            lat: p.lat,
            lon: p.lon,
            name: truthName(p.label, p.days),
          })),
        },
      });
    }
  });
}
