import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { normalizeTrack, parseTrackFile, TrackParseError } from '../src/data/gpx';

const parser = new DOMParser() as unknown as {
  parseFromString(t: string, type: 'text/xml'): Document;
};
const iso = (s: number) => new Date(Date.UTC(2026, 8, 1, 8, 0, s)).toISOString();

function gpxFile(points: [number, number, number | null][]): string {
  const rows = points
    .map(
      ([lat, lon, s]) =>
        `<trkpt lat="${lat}" lon="${lon}">${s === null ? '' : `<time>${iso(s)}</time>`}</trkpt>`,
    )
    .join('');
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${rows}</trkseg></trk></gpx>`;
}

describe('GPX parsing', () => {
  it('reads points and counts the ones without timestamps', () => {
    const f = parseTrackFile(
      'a.gpx',
      gpxFile([
        [40, 23, 0],
        [40.0001, 23, null],
        [40.0002, 23, 10],
      ]),
      parser,
    );
    expect(f.points).toHaveLength(2);
    expect(f.droppedNoTime).toBe(1);
    // The point after the missing timestamp keeps its own time (togeojson would shift it).
    expect(f.points[1]).toEqual({ lat: 40.0002, lon: 23, t: Date.parse(iso(10)) });
  });

  it('reads TCX through togeojson', () => {
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Biking"><Lap StartTime="${iso(0)}"><Track>
      <Trackpoint><Time>${iso(0)}</Time><Position><LatitudeDegrees>40</LatitudeDegrees><LongitudeDegrees>23</LongitudeDegrees></Position></Trackpoint>
      <Trackpoint><Time>${iso(5)}</Time><Position><LatitudeDegrees>40.0005</LatitudeDegrees><LongitudeDegrees>23</LongitudeDegrees></Position></Trackpoint>
      </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const f = parseTrackFile('ride.tcx', tcx, parser);
    expect(f.points).toHaveLength(2);
    expect(f.points[0]!.t).toBe(Date.parse(iso(0)));
  });

  it('rejects files that are not tracks', () => {
    expect(() => parseTrackFile('x.gpx', '<html><body/></html>', parser)).toThrow(TrackParseError);
  });
});

describe('normalizeTrack', () => {
  const a = parseTrackFile(
    'a.gpx',
    gpxFile([
      [40, 23, 0],
      [40.0005, 23, 10],
      [40.001, 23, 20],
    ]),
    parser,
  );
  const b = parseTrackFile(
    'b.gpx',
    gpxFile([
      [40.001, 23, 20],
      [40.0015, 23, 30],
      [40.002, 23, 40],
    ]),
    parser,
  );

  it('merges files, sorts by time and drops duplicates', () => {
    const { points, stats } = normalizeTrack([b, a]);
    expect(points.map((p) => p.t)).toEqual([0, 10, 20, 30, 40].map((s) => Date.parse(iso(s))));
    expect(stats.droppedDuplicates).toBe(1);
  });

  it('gives identical output whatever order the files come in', () => {
    expect(normalizeTrack([a, b]).points).toEqual(normalizeTrack([b, a]).points);
  });

  it('drops a GPS glitch (an impossible jump and back)', () => {
    const g = parseTrackFile(
      'g.gpx',
      gpxFile([
        [40, 23, 0],
        [40, 23.0005, 10],
        [40.5, 23.5, 20],
        [40, 23.001, 30],
        [40, 23.0015, 40],
      ]),
      parser,
    );
    const { points, stats } = normalizeTrack([g]);
    expect(stats.droppedGlitches).toBe(1);
    expect(points.every((p) => p.lat < 40.1)).toBe(true);
  });

  it('thins very dense recordings to one point per 5 s and computes speed', () => {
    const dense = parseTrackFile(
      'd.gpx',
      gpxFile(
        Array.from({ length: 21 }, (_, s) => [40 + s * 0.0001, 23, s] as [number, number, number]),
      ),
      parser,
    );
    const { points, stats } = normalizeTrack([dense]);
    expect(points).toHaveLength(5);
    expect(stats.droppedDownsample).toBe(16);
    // 5 s × ~11.1 m per second → ~40 km/h
    expect(points[1]!.speedKmh).toBeGreaterThan(35);
    expect(points[1]!.speedKmh).toBeLessThan(45);
  });
});
