import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { normalizeTrack, parseTrackFile, type ParsedFile } from '../src/data/gpx';
import { simulateCameras, type JunctionCandidate } from '../src/data/cameras-simulated';
import type { Camera, TrackPoint, Truth } from '../src/types';

/** Loads a committed demo persona from public/demo the way the app does, but from disk. */

const ROOT = join(import.meta.dirname, '..');

export type Manifest = {
  slug: string;
  timeZone: string;
  cameraMode: 'real' | 'simulated';
  files: string[];
}[];

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'demo', 'index.json'), 'utf8')) as Manifest;
}

export function loadDemoFiles(slug: string, order?: (files: string[]) => string[]): ParsedFile[] {
  const entry = loadManifest().find((m) => m.slug === slug)!;
  const parser = new DOMParser() as unknown as {
    parseFromString(t: string, type: 'text/xml'): Document;
  };
  const files = order ? order([...entry.files]) : entry.files;
  return files.map((f) =>
    parseTrackFile(f, readFileSync(join(ROOT, 'public', 'demo', slug, f), 'utf8'), parser),
  );
}

export function loadDemoTrack(slug: string): TrackPoint[] {
  return normalizeTrack(loadDemoFiles(slug)).points;
}

export function loadTruth(slug: string): Truth {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'demo', slug, 'truth.json'), 'utf8'),
  ) as Truth;
}

export function loadRealCameras(slug: string): Camera[] {
  return (
    JSON.parse(readFileSync(join(ROOT, 'public', 'demo', slug, 'cameras.json'), 'utf8')) as {
      cameras: Camera[];
    }
  ).cameras;
}

export function loadJunctions(slug: string): JunctionCandidate[] {
  return (
    JSON.parse(readFileSync(join(ROOT, 'public', 'demo', slug, 'junctions.json'), 'utf8')) as {
      junctions: JunctionCandidate[];
    }
  ).junctions;
}

export function demoCameras(slug: string, mode: 'real' | 'simulated'): Camera[] {
  return mode === 'real' ? loadRealCameras(slug) : simulateCameras(loadJunctions(slug));
}
