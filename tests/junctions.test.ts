import { describe, expect, it } from 'vitest';
import {
  findJunctionCandidates,
  isJunction,
  junctionCandidatesFromOverpass,
  sameRoad,
  seededUnit,
  simulateCameras,
  type RoadWay,
} from '../src/data/cameras-simulated';
import { mLat, mLon } from './helpers';

const LAT = 40.6;
const node = (dxM: number, dyM: number) => ({ lat: LAT + mLat(dyM), lon: 22.9 + mLon(dxM, LAT) });

describe('junction detection', () => {
  const nodes = new Map([
    [1, node(0, 0)],
    [2, node(100, 0)],
    [3, node(200, 0)],
    [4, node(100, -100)],
    [5, node(100, 100)],
  ]);

  it('a road split into two ways is NOT a junction', () => {
    const ways: RoadWay[] = [
      { id: 10, nodes: [1, 2], tags: { highway: 'primary', name: 'Egnatia' } },
      { id: 11, nodes: [2, 3], tags: { highway: 'primary', name: 'Egnatia' } },
    ];
    expect(findJunctionCandidates(ways, nodes)).toEqual([]);
  });

  it('two differently named roads crossing IS a junction', () => {
    const ways: RoadWay[] = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: 'primary', name: 'Egnatia' } },
      { id: 20, nodes: [4, 2, 5], tags: { highway: 'secondary', name: 'Venizelou' } },
    ];
    const js = findJunctionCandidates(ways, nodes);
    expect(js.map((j) => j.id)).toEqual([2]);
    expect(js[0]!.roads).toHaveLength(2);
  });

  it('same road by ref (name on one way, ref on both) is not a junction', () => {
    expect(
      sameRoad(
        { cls: 'trunk', name: 'Peachtree St', ref: 'SR 9' },
        { cls: 'trunk', ref: 'SR 9;US 19' },
      ),
    ).toBe(true);
    expect(
      isJunction([
        { cls: 'trunk', name: 'A' },
        { cls: 'trunk', name: 'B' },
      ]),
    ).toBe(true);
    // Two nameless ways of the same class: treated as one road (no false junctions at splits).
    expect(isJunction([{ cls: 'tertiary' }, { cls: 'tertiary' }])).toBe(false);
    expect(isJunction([{ cls: 'tertiary' }, { cls: 'primary' }])).toBe(true);
  });

  it('respects the chosen road classes', () => {
    const roads = [
      { cls: 'primary' as const, name: 'A' },
      { cls: 'tertiary' as const, name: 'B' },
    ];
    expect(isJunction(roads, new Set(['primary', 'secondary']))).toBe(false);
    expect(isJunction(roads, new Set(['primary', 'tertiary']))).toBe(true);
  });

  it('reads Overpass "out body; >; out skel" responses', () => {
    const resp = {
      elements: [
        { type: 'way' as const, id: 10, nodes: [1, 2, 3], tags: { highway: 'primary', name: 'A' } },
        { type: 'way' as const, id: 20, nodes: [4, 2, 5], tags: { highway: 'primary', name: 'B' } },
        ...[...nodes].map(([id, p]) => ({ type: 'node' as const, id, lat: p.lat, lon: p.lon })),
      ],
    };
    expect(junctionCandidatesFromOverpass(resp).map((j) => j.id)).toEqual([2]);
  });
});

describe('simulated cameras', () => {
  const cand = (id: number, dx: number, dy: number) => ({
    id,
    ...node(dx, dy),
    roads: [
      { cls: 'primary' as const, name: `R${id}` },
      { cls: 'secondary' as const, name: `Q${id}` },
    ],
  });
  // Two nodes of one complex intersection (12 m apart) and three separate junctions.
  const candidates = [
    cand(1, 0, 0),
    cand(2, 12, 0),
    cand(3, 500, 0),
    cand(4, 1000, 0),
    cand(5, 1060, 0),
  ];

  it('merges junction nodes within 30 m into one camera', () => {
    const cams = simulateCameras(candidates, { coverage: 1, minSpacingM: 0 });
    expect(cams).toHaveLength(4);
    expect(cams.every((c) => c.simulated)).toBe(true);
    expect(cams[0]!.id).toBe('sim-1');
  });

  it('coverage sampling is deterministic', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      cand(i + 1, (i % 20) * 200, Math.floor(i / 20) * 200),
    );
    const a = simulateCameras(many, { coverage: 0.5, seed: 7 });
    const b = simulateCameras(many, { coverage: 0.5, seed: 7 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.length).toBeGreaterThan(150);
    expect(a.length).toBeLessThan(250);
    expect(simulateCameras(many, { coverage: 0 })).toHaveLength(0);
    expect(seededUnit(1, 42)).toBe(seededUnit(1, 42));
    expect(seededUnit(1, 42)).not.toBe(seededUnit(2, 42));
  });

  it('enforces a minimum spacing', () => {
    const cams = simulateCameras(candidates, { coverage: 1, minSpacingM: 100 });
    // 1000 m and 1060 m are too close: only one of them survives.
    expect(cams).toHaveLength(3);
  });
});
