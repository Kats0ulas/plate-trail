/**
 * Dev tool used once to choose the demo personas' places: for a place, try nearby spots and
 * keep the one where the car passes a camera close by when arriving and when leaving, so the
 * demo shows clearly what a dense camera network can infer. Prints the best candidates.
 *
 *   npx tsx scripts/calibrate-places.ts atlanta home work,gym,grocery
 */
import { detect } from '../src/engine/detection';
import { haversineM, midpoint } from '../src/engine/geo';
import { DETECTION_DEFAULTS } from '../src/engine/params';
import type { Camera, TrackPoint } from '../src/types';
import { demoCameras } from '../tests/load-demo';
import { CITIES } from './make-demo';
import { osrmRoute, type LL } from './osrm';

const [slug, placeId, connArg, modeArg] = process.argv.slice(2);
const city = CITIES.find((c) => c.slug === slug)!;
const place = city.places[placeId!]!;
const connections = (connArg ?? 'home').split(',').map((id) => city.places[id]!);
const cams: Camera[] = demoCameras(slug!, city.cameraMode);
const parking = modeArg === 'park' || !!place.park; // the car stops away from the place itself
const P = { lat: place.at[0], lon: place.at[1] };

function routeTrack(coords: LL[]): TrackPoint[] {
  const pts: TrackPoint[] = [];
  let t = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      const a = { lat: coords[i - 1]![0], lon: coords[i - 1]![1] };
      const b = { lat: coords[i]![0], lon: coords[i]![1] };
      const d = haversineM(a, b);
      const steps = Math.max(1, Math.ceil(d / 55));
      for (let k = 1; k <= steps; k++)
        pts.push({
          lat: a.lat + ((b.lat - a.lat) * k) / steps,
          lon: a.lon + ((b.lon - a.lon) * k) / steps,
          t: (t += (d / steps / 11) * 1000),
        });
    } else pts.push({ lat: coords[0]![0], lon: coords[0]![1], t });
  }
  return pts;
}

const near = cams
  .map((c) => ({ c, d: haversineM(P, c) }))
  .filter((x) => x.d < (parking ? 450 : 900))
  .sort((a, b) => a.d - b.d)
  .slice(0, parking ? 5 : 5);
const only = process.argv.find((a) => a.startsWith('--only='));
const candidates: LL[] = only
  ? only
      .slice(7)
      .split(';')
      .map((pair) => pair.split(',').map(Number) as LL)
  : [place.park ?? place.at];
if (!only)
  for (const { c } of near)
    for (const r of parking ? [40, 90] : [130, 220])
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        const lat = c.lat + (r * Math.cos(a)) / 111_195;
        const lon = c.lon + (r * Math.sin(a)) / (111_195 * Math.cos((c.lat * Math.PI) / 180));
        if (parking && haversineM(P, { lat, lon }) > 400) continue;
        candidates.push([Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
      }

const results: { cand: LL; score: number; detail: string }[] = [];
for (const cand of candidates) {
  let worst = 0;
  const detail: string[] = [];
  for (const q of connections) {
    const qAt = q.park ?? q.at;
    const inbound = detect(
      routeTrack((await osrmRoute(qAt, cand)).coords),
      cams,
      DETECTION_DEFAULTS,
    );
    const outbound = detect(
      routeTrack((await osrmRoute(cand, qAt)).coords),
      cams,
      DETECTION_DEFAULTS,
    );
    const lastIn = inbound[inbound.length - 1];
    const firstOut = outbound[0];
    if (!lastIn || !firstOut) {
      worst = Infinity;
      break;
    }
    const est = midpoint(lastIn, firstOut);
    const err = haversineM(parking ? P : { lat: cand[0], lon: cand[1] }, est);
    worst = Math.max(worst, err);
    detail.push(`${q.name.split(' ')[0]}:${Math.round(err)}`);
  }
  if (Number.isFinite(worst)) results.push({ cand, score: worst, detail: detail.join(' ') });
}
results.sort((a, b) => a.score - b.score);
console.log(`${placeId}: ${candidates.length} candidates`);
for (const r of results.slice(0, 6))
  console.log(`  [${r.cand[0]}, ${r.cand[1]}]  worst ${Math.round(r.score)} m  ${r.detail}`);
