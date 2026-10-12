import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferFromDetections } from '../src/engine/observer';
import { defaultEngineParams } from '../src/engine/params';

/**
 * The observer must only ever see camera reads and camera positions. These tests walk the
 * observer's whole import graph and fail if anything in it can reach the raw GPS track.
 */

const SRC = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  'src',
);

function importGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const m of text.matchAll(/^\s*import\s+(?:type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      visit(resolve(dirname(file), m[1]!) + '.ts');
    }
  };
  visit(entry);
  return seen;
}

const graph = importGraph(resolve(SRC, 'engine', 'observer.ts'));
const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/');

describe('observer isolation', () => {
  it('never imports the ground truth, the detection engine, the data loaders or the worker', () => {
    const files = [...graph.keys()].map(rel);
    expect(files).toContain('engine/observer.ts');
    for (const f of files) {
      expect(f).not.toMatch(/ground-truth|detection|^data\/|worker|^ui\/|^map\//);
    }
  });

  it('no module the observer depends on uses the TrackPoint type', () => {
    for (const [file, text] of graph) {
      if (rel(file) === 'types.ts') continue; // declares every shared type; holds no data
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // ignore comments
      expect(code, rel(file)).not.toMatch(/\bTrackPoint\b/);
    }
  });

  it('works from reads and cameras alone', () => {
    const p = defaultEngineParams();
    const result = inferFromDetections(
      [],
      [],
      { observer: p.observer, labeling: p.labeling, schedule: p.schedule },
      'UTC',
    );
    expect(result.places).toEqual([]);
    expect(result.stats.reads).toBe(0);
    // Signature: (detections, cameras, params, timeZone) — no track argument exists.
    expect(inferFromDetections.length).toBe(4);
  });
});
