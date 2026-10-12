import { DEFAULT_RETENTION_ID } from './config/retention';
import type { NormalizeStats } from './data/gpx';
import { DETECTION_DEFAULTS, SIMULATION_DEFAULTS, type RoadClass } from './engine/params';
import { browserTimeZone } from './engine/time';
import { Store } from './store';
import type { Camera, ComparisonRow, Detection, InferenceResult, PlaceScore, Truth } from './types';

export type CameraMode = 'real' | 'simulated' | 'both';

export type Dataset = {
  kind: 'demo' | 'user';
  name: string;
  /** demo slug, used to find the bundled OSM snapshot */
  slug?: string;
  persona?: string;
  start: number;
  end: number;
  stats: NormalizeStats;
  /** For demos: the persona's own zone. */
  timeZone?: string;
};

export type CameraStatus = {
  state: 'idle' | 'loading' | 'ready' | 'error';
  message: string;
  /** Where the camera data came from. */
  source: 'live' | 'snapshot' | null;
  fetchedAt?: string;
  realCount: number;
  simulatedCount: number;
};

/** Labelled true places: from truth.json (demo) or computed from the user's own track. */
export type TruthView = {
  source: 'persona' | 'gps';
  places: Truth['places'];
  result?: InferenceResult;
};

export type AppState = {
  phase: 'landing' | 'loading' | 'ready';
  loadingMessage: string;
  notice: string | null;
  error: string | null;
  dataset: Dataset | null;
  /** Explicit choice in settings; null = use the dataset's or the browser's zone. */
  tzOverride: string | null;
  cameraMode: CameraMode;
  simCoverage: number; // 0–100
  simMinSpacingM: number;
  simRoadClasses: RoadClass[];
  radiusM: number;
  vehicleOnly: boolean;
  directionFilter: boolean;
  retentionId: string;
  T: number;
  playing: boolean;
  /** Simulated ms per real second. */
  speed: number;
  showTrack: boolean;
  revealTruth: boolean;
  cameras: Camera[];
  cameraStatus: CameraStatus;
  detections: Detection[];
  detecting: boolean;
  inference: InferenceResult | null;
  truth: TruthView | null;
  scores: PlaceScore[] | null;
  comparison: ComparisonRow[] | null;
  comparisonT: number | null;
  sheet: 'controls' | 'notebook';
  sheetOpen: boolean;
};

export const HOUR = 3_600_000;
export const SPEEDS = [
  { label: '1 h/s', value: HOUR },
  { label: '6 h/s', value: 6 * HOUR },
  { label: '1 day/s', value: 24 * HOUR },
] as const;

export const store = new Store<AppState>({
  phase: 'landing',
  loadingMessage: '',
  notice: null,
  error: null,
  dataset: null,
  tzOverride: null,
  cameraMode: 'real',
  simCoverage: Math.round(SIMULATION_DEFAULTS.coverage * 100),
  simMinSpacingM: SIMULATION_DEFAULTS.minSpacingM,
  simRoadClasses: [...SIMULATION_DEFAULTS.roadClasses],
  radiusM: DETECTION_DEFAULTS.radiusM,
  vehicleOnly: DETECTION_DEFAULTS.vehicleOnly,
  directionFilter: DETECTION_DEFAULTS.directionFilter,
  retentionId: DEFAULT_RETENTION_ID,
  T: 0,
  playing: false,
  speed: 6 * HOUR,
  showTrack: false,
  revealTruth: false,
  cameras: [],
  cameraStatus: { state: 'idle', message: '', source: null, realCount: 0, simulatedCount: 0 },
  detections: [],
  detecting: false,
  inference: null,
  truth: null,
  scores: null,
  comparison: null,
  comparisonT: null,
  sheet: 'notebook',
  sheetOpen: false,
});

/** The zone all local-time logic uses right now. */
export function effectiveTimeZone(s: AppState = store.get()): string {
  return s.tzOverride ?? s.dataset?.timeZone ?? browserTimeZone();
}
