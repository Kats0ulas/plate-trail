/**
 * Every threshold the engine uses, in one place. Units are in the names.
 * Change a default here and every caller (worker, tests, demo generator) follows.
 */

const MIN = 60_000;

export const DETECTION_DEFAULTS = {
  /** A camera "reads" the vehicle if the GPS path passes within this distance. Spec: 30 m, UI 15 to 60 m. */
  radiusM: 30,
  radiusMinM: 15,
  radiusMaxM: 60,
  /** ALPRs read number plates, so only count passes at vehicle speed. Walking/running produce no reads. */
  vehicleOnly: true,
  minVehicleKmh: 15,
  maxVehicleKmh: 200,
  /**
   * Cars crawl in traffic; people on foot never reach car speed. A slow segment still counts as
   * driving if the vehicle reaches minVehicleKmh within ± this window.
   */
  vehicleWindowMs: 45_000,
  /** Optional: only count passes roughly along the camera's facing (or its reverse). */
  directionFilter: false,
  directionToleranceDeg: 45,
  /** The same camera reading the same vehicle again within this window counts once. */
  dedupeMs: 2 * MIN,
  /**
   * Segments longer than this in time are a recording gap, not a drive; interpolating
   * a straight line across them would invent passes that never happened.
   */
  maxSegmentGapMs: 3 * MIN,
};
export type DetectionParams = typeof DETECTION_DEFAULTS;

export const OBSERVER_DEFAULTS = {
  /** A silence longer than this between two reads splits them into separate trips. */
  tripGapMs: 20 * MIN,
  /** A stay's location is the midpoint of its two bracketing cameras; never claim to know it better than this. */
  minStayUncertaintyM: 300,
  /** Stays whose bracketing cameras are this far apart say nothing useful about a place. */
  maxStayUncertaintyM: 2_000,
  /** DBSCAN on stay candidates. */
  clusterEpsM: 500,
  clusterMinPoints: 2,
};
export type ObserverParams = typeof OBSERVER_DEFAULTS;

export const GROUND_TRUTH_DEFAULTS = {
  /** Classic stay-point detection: the person stayed within this radius… */
  stayRadiusM: 150,
  /** …for at least this long. */
  stayMinMs: 10 * MIN,
  /** DBSCAN on stay points → significant places. */
  clusterEpsM: 150,
  clusterMinPoints: 2,
};
export type GroundTruthParams = typeof GROUND_TRUTH_DEFAULTS;

/** Shared rules that turn stays into Home / Work / Recurring / Rare, for observer and truth alike. */
export const LABELING_DEFAULTS = {
  /** Home: the place with the most time overlapping this local night window. */
  nightStartMin: 0,
  nightEndMin: 6 * 60,
  /** Work: the most weekday time inside this local window, on enough different days. */
  workStartMin: 9 * 60,
  workEndMin: 17 * 60,
  workMinDays: 3,
  /** A weekday only counts towards "work" if at least this much of the window was spent there. */
  workMinDailyMs: 60 * MIN,
  /** Recurring place (gym, supermarket…): stays of this length… */
  recurringMinMs: 30 * MIN,
  recurringMaxMs: 150 * MIN,
  /** …on at least this many days… */
  recurringMinDays: 2,
  /** …arriving within ± this many minutes of the usual time. */
  recurringTimeToleranceMin: 90,
  /** Rare visit: one single stay longer than this at a place not visited otherwise. */
  rareMinMs: 45 * MIN,
  /** Confidence: High needs this many supporting days and a location known to within highMaxRadiusM. */
  highMinDays: 4,
  highMaxRadiusM: 450,
  /** Medium needs this many days, or this much total time, and a location within mediumMaxRadiusM. */
  mediumMinDays: 2,
  mediumMinDwellMs: 3 * 60 * MIN,
  mediumMaxRadiusM: 1_200,
  /** Smallest uncertainty circle shown for an inferred place. */
  minPlaceRadiusM: 120,
};
export type LabelingParams = typeof LABELING_DEFAULTS;

export const SCHEDULE_DEFAULTS = {
  /** Only departures from home in this local window count as "leaving in the morning". */
  morningStartMin: 4 * 60,
  morningEndMin: 13 * 60,
  /** Predictability falls off as the average spread of daily times grows past this. */
  spreadScaleMin: 45,
};
export type ScheduleParams = typeof SCHEDULE_DEFAULTS;

export const SCORING_DEFAULTS = {
  /** An inferred place is a hit if it is within this distance of a true place with the same label. */
  hitRadiusM: 500,
};

export const INPUT_DEFAULTS = {
  /** A jump implying more than this speed is a GPS glitch, not a journey. */
  glitchKmh: 250,
  /** Very large inputs are thinned to at most one point per this interval. */
  minSampleMs: 5_000,
};

export const SIMULATION_DEFAULTS = {
  /** Junction nodes closer than this are one intersection → one camera. */
  mergeRadiusM: 30,
  /** Share of junctions that get a hypothetical camera, 0 to 1. */
  coverage: 1,
  /** No two hypothetical cameras closer than this. 0 = off. */
  minSpacingM: 0,
  /** Same seed + same settings → same cameras. */
  seed: 1,
  roadClasses: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'] as RoadClass[],
};
export const ALL_ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'] as const;
export type RoadClass = (typeof ALL_ROAD_CLASSES)[number];

export const OVERPASS_DEFAULTS = {
  /** Coarse grid used for every Overpass query (≈10 km). Never send the track's exact bbox. */
  cellDeg: 0.1,
};

export type EngineParams = {
  detection: DetectionParams;
  observer: ObserverParams;
  groundTruth: GroundTruthParams;
  labeling: LabelingParams;
  schedule: ScheduleParams;
};

export function defaultEngineParams(): EngineParams {
  return {
    detection: { ...DETECTION_DEFAULTS },
    observer: { ...OBSERVER_DEFAULTS },
    groundTruth: { ...GROUND_TRUTH_DEFAULTS },
    labeling: { ...LABELING_DEFAULTS },
    schedule: { ...SCHEDULE_DEFAULTS },
  };
}
