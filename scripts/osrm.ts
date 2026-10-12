/** Driving routes from the public OSRM demo server, cached on disk (light, one-off use). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LL = [lat: number, lon: number];
export type Route = { coords: LL[]; durations: number[] };

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache');
const USER_AGENT = 'plate-trail demo generator (one-off, cached)';

export async function osrmRoute(from: LL, to: LL): Promise<Route> {
  mkdirSync(join(CACHE, 'osrm'), { recursive: true });
  const key = `${from[0].toFixed(5)}_${from[1].toFixed(5)}__${to[0].toFixed(5)}_${to[1].toFixed(5)}`;
  const file = join(CACHE, 'osrm', key + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Route;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}` +
    `?overview=full&geometries=geojson&annotations=duration`;
  await new Promise((r) => setTimeout(r, 1100)); // be polite: ≤ 1 request per second
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`OSRM ${res.status} for ${key}`);
  const j = (await res.json()) as {
    code: string;
    routes: {
      geometry: { coordinates: [number, number][] };
      legs: { annotation: { duration: number[] } }[];
    }[];
  };
  if (j.code !== 'Ok' || !j.routes[0]) throw new Error(`OSRM: ${j.code} for ${key}`);
  const route: Route = {
    coords: j.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon] as LL),
    durations: j.routes[0].legs[0]!.annotation.duration,
  };
  writeFileSync(file, JSON.stringify(route));
  console.log(`  routed ${key} (${route.coords.length} pts)`);
  return route;
}
