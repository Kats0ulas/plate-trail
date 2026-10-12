/**
 * The engine's Web Worker. The track arrives once and stays here; detection, the observer,
 * ground truth and the retention comparison all run off the main thread.
 */
import type { Camera, Detection, TrackPoint } from '../types';
import { buildCameraIndex, detect, type CameraIndex } from './detection';
import { groundTruthFromTrack } from './ground-truth';
import { inferFromDetections } from './observer';
import type { DetectionParams, EngineParams } from './params';
import { visibleDetections } from './retention';
import { compareRetention, type TruthRef } from './scoring';

export type WorkerRequest =
  | { type: 'setTrack'; points: TrackPoint[] }
  | { type: 'setCameras'; cameras: Camera[] }
  | { type: 'detect'; params: DetectionParams }
  | {
      type: 'infer';
      T: number;
      retentionHours: number | null;
      timeZone: string;
      params: EngineParams;
    }
  | { type: 'groundTruth'; timeZone: string; params: EngineParams }
  | {
      type: 'compare';
      T: number;
      presets: { id: string; hours: number | null }[];
      timeZone: string;
      params: EngineParams;
      truth: TruthRef[];
      hitRadiusM: number;
    };

export type WorkerEnvelope = { id: number; req: WorkerRequest };
export type WorkerReply =
  { id: number; ok: true; data: unknown; ms: number } | { id: number; ok: false; error: string };

let track: TrackPoint[] = [];
let cameras: Camera[] = [];
let index: CameraIndex = buildCameraIndex([]);
let detections: Detection[] = [];

function handle(req: WorkerRequest): unknown {
  switch (req.type) {
    case 'setTrack':
      track = req.points;
      detections = [];
      return { points: track.length };
    case 'setCameras':
      cameras = req.cameras;
      index = buildCameraIndex(cameras);
      detections = [];
      return { cameras: cameras.length };
    case 'detect':
      detections = detect(track, index, req.params);
      return detections;
    case 'infer': {
      // The observer gets camera reads and camera positions — never the track.
      const visible = visibleDetections(detections, req.T, req.retentionHours);
      return inferFromDetections(visible, cameras, req.params, req.timeZone);
    }
    case 'groundTruth':
      return groundTruthFromTrack(track, req.params, req.timeZone);
    case 'compare':
      return compareRetention(
        detections,
        cameras,
        req.T,
        req.presets,
        req.params,
        req.timeZone,
        req.truth,
        req.hitRadiusM,
      );
  }
}

self.onmessage = (e: MessageEvent<WorkerEnvelope>) => {
  const { id, req } = e.data;
  const start = performance.now();
  try {
    const data = handle(req);
    self.postMessage({ id, ok: true, data, ms: performance.now() - start } satisfies WorkerReply);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message } satisfies WorkerReply);
  }
};
