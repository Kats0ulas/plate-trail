/** One GPS fix from the user's own history. Only the browser ever sees these. */
export type TrackPoint = {
  lat: number;
  lon: number;
  /** epoch ms, UTC */
  t: number;
  speedKmh?: number;
};

/** An ALPR camera, either mapped in OpenStreetMap or simulated at a major junction. */
export type Camera = {
  id: string;
  /** Short human label used in explanations, e.g. "#12" (real) or "S7" (hypothetical). */
  label: string;
  lat: number;
  lon: number;
  simulated: boolean;
  /** Facing directions in degrees (0 = north), when the OSM `direction` tag says so. */
  directions?: number[];
  manufacturer?: string;
  operator?: string;
  zone?: string;
};

/** What the camera network records: a plate read at a camera at a moment in time. */
export type Detection = {
  id: string;
  cameraId: string;
  t: number;
  /** The CAMERA's position, not the GPS point. */
  lat: number;
  lon: number;
  headingDeg: number;
  speedKmh: number;
  simulated: boolean;
};

export type PlaceLabel = 'home' | 'work' | 'recurring' | 'rare';

export type Confidence = 'Low' | 'Medium' | 'High';

/** A place someone (the observer, or the ground truth) believes matters in this person's life. */
export type Place = {
  id: string;
  label: PlaceLabel;
  lat: number;
  lon: number;
  /** How sure we are about the location, metres. */
  radiusM: number;
  confidence: Confidence;
  /** Distinct local days with a stay here. */
  days: number;
  visits: number;
  totalDwellMs: number;
  /** Plain-language reasons, shown under "Why we think this". */
  evidence: string[];
  /** Typical arrival time, minutes after local midnight. */
  typicalArrivalMin?: number;
  firstSeen: number;
  lastSeen: number;
  name?: string;
};

/** Mean ± standard deviation of a time of day, in minutes after local midnight. */
export type TimeStat = { meanMin: number; stdMin: number; n: number };

export type ScheduleRow = {
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  days: number;
  leaveHome?: TimeStat;
  arriveWork?: TimeStat;
  leaveWork?: TimeStat;
  returnHome?: TimeStat;
};

export type Schedule = {
  rows: ScheduleRow[];
  /** 0 to 100: how predictable the routine is (low spread, many days). */
  predictability: number;
  confidence: Confidence;
  evidence: string[];
};

export type InferenceStats = {
  reads: number;
  distinctCameras: number;
  daysCovered: number;
  trips: number;
  stays: number;
};

export type InferenceResult = {
  places: Place[];
  schedule: Schedule;
  stats: InferenceStats;
};

/** Labelled places from a demo persona's truth.json (or computed from the full GPS track). */
export type TruthPlace = {
  id: string;
  label: PlaceLabel;
  lat: number;
  lon: number;
  name: string;
  /** e.g. the rally: the visit that only longer retention reveals. */
  sensitive?: boolean;
  visits?: { arrive: number; depart: number }[];
};

export type Truth = {
  city: string;
  timeZone: string;
  start: number;
  end: number;
  persona: string;
  places: TruthPlace[];
  /** Typical times from the persona's actual week. */
  schedule: ScheduleRow[];
};

export type PlaceScore = {
  inferredId: string;
  truthId: string | null;
  label: PlaceLabel;
  errorM: number | null;
  hit: boolean;
};

export type ComparisonRow = {
  presetId: string;
  reads: number;
  placesFound: number;
  placesTotal: number;
  meanErrorM: number | null;
  homeErrorM: number | null;
  scheduleConfidence: Confidence | null;
  predictability: number;
  foundLabels: string[];
};
