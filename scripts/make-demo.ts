/**
 * Generates the synthetic demo personas: ~5 weeks of continuous driving and walking along
 * real roads, written as one GPX file per day, plus truth.json (what the person really did).
 *
 *   npm run demo                         # all cities
 *   npx tsx scripts/make-demo.ts athens      # one city
 *   npx tsx scripts/make-demo.ts no-osm      # don't touch the OSM camera/junction snapshots
 *   npx tsx scripts/make-demo.ts refresh-osm # re-download them even if they cover the track
 *
 * Routing uses the public OSRM demo server once per distinct route (cached in scripts/.cache),
 * well within its light-use policy. Nobody's real location data is involved: every place below
 * is a public landmark or an arbitrary residential street, and every timestamp is invented.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { haversineM } from '../src/engine/geo';
import { osrmRoute, type LL, type Route } from './osrm';
import { DAY, MINUTE, localTime, zonedTimeToUtc } from '../src/engine/time';
import {
  cellKey,
  cellsForPoints,
  overpassFetch,
  alprQuery,
  roadsQuery,
  OVERPASS_ENDPOINTS,
} from '../src/data/overpass';
import { camerasFromOverpass } from '../src/data/cameras-real';
import {
  junctionCandidatesFromOverpass,
  type JunctionCandidate,
} from '../src/data/cameras-simulated';
import type {
  Camera,
  PlaceLabel,
  ScheduleRow,
  TimeStat,
  Truth,
  TruthPlace,
  TrackPoint,
} from '../src/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'plate-trail demo generator (one-off, cached)';

export type PlaceDef = {
  name: string;
  label: PlaceLabel;
  /** Where the person spends the time (building, plaza…). */
  at: LL;
  /** Where the car is left; the person walks between this and `at`. Defaults to `at`. */
  park?: LL;
  sensitive?: boolean;
};

/** "At local time `leave`, go from wherever you are to `to`." */
type Leg = { to: string; leave: number };

export type CityDef = {
  slug: string;
  city: string;
  country: string;
  timeZone: string;
  cameraMode: 'real' | 'simulated';
  persona: string;
  blurb: string;
  places: Record<string, PlaceDef>;
  plan: (day: DayInfo, rng: Rng) => Leg[];
};

type DayInfo = {
  index: number;
  week: number;
  weekday: number;
  y: number;
  m: number;
  d: number;
  iso: string;
};

const START = { y: 2026, m: 8, d: 31 }; // Monday
const DAYS = 35; // five full weeks, ending Sunday 4 October 2026

// Randomness

type Rng = {
  next(): number;
  range(a: number, b: number): number;
  normal(sd: number): number;
  pick<T>(xs: T[]): T;
};
function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    normal: (sd) => {
      const u = Math.max(next(), 1e-12);
      return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    pick: (xs) => xs[Math.floor(next() * xs.length)]!,
  };
}

const hm = (h: number, m = 0) => h * 60 + m;
const jitter = (rng: Rng, base: number, plusMinus: number) =>
  base + Math.round(rng.range(-plusMinus, plusMinus));

// The personas

const THESSALONIKI: CityDef = {
  slug: 'thessaloniki',
  city: 'Thessaloniki, Greece',
  country: 'GR',
  timeZone: 'Europe/Athens',
  cameraMode: 'simulated',
  persona: 'Eleni, an office worker living in Kalamaria, Thessaloniki',
  blurb: 'Hypothetical cameras at every major junction (few ALPRs are mapped in Greece).',
  places: {
    home: { name: 'Home (Kalamaria)', label: 'home', at: [40.58555, 22.95205] },
    work: {
      name: 'Office (near the railway station)',
      label: 'work',
      at: [40.64205, 22.93105],
      park: [40.64218, 22.93111],
    },
    gym: { name: 'Gym (Toumba)', label: 'recurring', at: [40.60805, 22.96905] },
    grocery: { name: 'Supermarket (Kalamaria)', label: 'recurring', at: [40.58005, 22.96005] },
    friend: { name: "Friend's place (Pylaia)", label: 'recurring', at: [40.59905, 22.98705] },
    park: {
      name: 'Nea Paralia (waterfront)',
      label: 'recurring',
      at: [40.62145, 22.95185],
      park: [40.62245, 22.95305],
    },
    rally: {
      name: 'Rally at Aristotelous Square',
      label: 'rare',
      at: [40.63245, 22.94065],
      park: [40.63331, 22.93894],
      sensitive: true,
    },
    restaurant: { name: 'Taverna (Ano Poli)', label: 'rare', at: [40.64305, 22.95905] },
    beach: {
      name: 'Beach (Perea)',
      label: 'rare',
      at: [40.49905, 22.92505],
      park: [40.50005, 22.92605],
    },
    mall: {
      name: 'Shopping centre (Mediterranean Cosmos)',
      label: 'rare',
      at: [40.51305, 22.97205],
    },
    halkidiki: {
      name: 'Weekend away (Kallithea, Halkidiki)',
      label: 'rare',
      at: [40.07805, 23.44705],
    },
  },
  plan(day, rng) {
    const legs: Leg[] = [];
    const wd = day.weekday;
    if (day.iso === '2026-09-05') return [{ to: 'halkidiki', leave: jitter(rng, hm(10, 0), 10) }];
    if (day.iso === '2026-09-06') return [{ to: 'home', leave: jitter(rng, hm(17, 0), 15) }];
    if (wd <= 4) {
      legs.push({ to: 'work', leave: jitter(rng, hm(8, 20), 15) });
      const leaveWork = jitter(rng, hm(17, 0), 15);
      if (day.iso === '2026-09-16') {
        legs.push({ to: 'rally', leave: jitter(rng, hm(18, 40), 5) });
        legs.push({ to: 'home', leave: jitter(rng, hm(21, 0), 5) });
      } else if (wd === 1 || wd === 3 || (wd === 0 && day.week % 2 === 1)) {
        legs.push({ to: 'gym', leave: leaveWork });
        legs.push({ to: 'home', leave: leaveWork + 25 + Math.round(rng.range(60, 80)) });
      } else {
        legs.push({ to: 'home', leave: leaveWork });
      }
    } else if (wd === 5) {
      const shop = jitter(rng, hm(11, 0), 20);
      legs.push(
        { to: 'grocery', leave: shop },
        { to: 'home', leave: shop + Math.round(rng.range(45, 60)) },
      );
      if (day.week === 1 || day.week === 3) {
        const t = jitter(rng, hm(20, 30), 10);
        legs.push({ to: 'friend', leave: t }, { to: 'home', leave: t + 145 });
      } else if (day.week === 2) {
        const t = jitter(rng, hm(21, 0), 10);
        legs.push({ to: 'restaurant', leave: t }, { to: 'home', leave: t + 130 });
      }
    } else {
      if (day.week === 1 || day.week === 3) {
        const t = jitter(rng, hm(18, 0), 10);
        legs.push({ to: 'park', leave: t }, { to: 'home', leave: t + 120 });
      } else if (day.week === 2) {
        const t = jitter(rng, hm(11, 30), 10);
        legs.push({ to: 'beach', leave: t }, { to: 'home', leave: t + 240 });
      } else if (day.week === 4) {
        const t = jitter(rng, hm(12, 30), 10);
        legs.push({ to: 'mall', leave: t }, { to: 'home', leave: t + 150 });
      }
    }
    return legs;
  },
};

const PATRAS: CityDef = {
  slug: 'patras',
  city: 'Patras, Greece',
  country: 'GR',
  timeZone: 'Europe/Athens',
  cameraMode: 'simulated',
  persona: 'Dimitra, who works at the University of Patras and lives in Zarouchleika',
  blurb: 'Hypothetical cameras at every major junction (few ALPRs are mapped in Greece).',
  places: {
    home: { name: 'Home (Zarouchleika)', label: 'home', at: [38.2218, 21.733] },
    work: { name: 'Office (University of Patras, Rio)', label: 'work', at: [38.28692, 21.7851] },
    gym: { name: 'Gym (Agyia)', label: 'recurring', at: [38.25976, 21.7389] },
    grocery: { name: 'Supermarket (Perivola)', label: 'recurring', at: [38.2096, 21.76054] },
    friend: { name: "Friend's place (Proastio)", label: 'recurring', at: [38.28038, 21.76925] },
    park: { name: 'Plaz (seafront walk)', label: 'recurring', at: [38.28167, 21.74954] },
    rally: {
      name: 'Rally at Plateia Georgiou A’',
      label: 'rare',
      at: [38.24623, 21.73511],
      sensitive: true,
    },
    restaurant: { name: 'Taverna by Rio castle', label: 'rare', at: [38.3114, 21.78129] },
    beach: { name: 'Beach (Psathopyrgos)', label: 'rare', at: [38.32635, 21.87496] },
    winery: { name: 'Achaia Clauss winery', label: 'rare', at: [38.19643, 21.77143] },
    nafpaktos: { name: 'Weekend away (Nafpaktos)', label: 'rare', at: [38.39261, 21.82874] },
  },
  plan(day, rng) {
    const legs: Leg[] = [];
    const wd = day.weekday;
    if (day.iso === '2026-09-26') return [{ to: 'nafpaktos', leave: jitter(rng, hm(10, 30), 10) }];
    if (day.iso === '2026-09-27') return [{ to: 'home', leave: jitter(rng, hm(18, 0), 15) }];
    if (wd <= 4) {
      legs.push({ to: 'work', leave: jitter(rng, hm(7, 50), 15) });
      const leaveWork = jitter(rng, hm(16, 0), 15);
      if (day.iso === '2026-09-16') {
        // The one-off: an evening rally in the city centre, ~18 days before the data ends.
        legs.push({ to: 'home', leave: leaveWork });
        legs.push({ to: 'rally', leave: jitter(rng, hm(18, 20), 5) });
        legs.push({ to: 'home', leave: jitter(rng, hm(20, 45), 5) });
      } else if (wd === 1 || wd === 3 || (wd === 0 && day.week % 2 === 1)) {
        legs.push({ to: 'gym', leave: leaveWork });
        legs.push({ to: 'home', leave: leaveWork + 25 + Math.round(rng.range(60, 80)) });
      } else {
        legs.push({ to: 'home', leave: leaveWork });
      }
    } else if (wd === 5) {
      const shop = jitter(rng, hm(10, 30), 20);
      legs.push(
        { to: 'grocery', leave: shop },
        { to: 'home', leave: shop + Math.round(rng.range(50, 65)) },
      );
      // (week 3's weekend is the Nafpaktos trip)
      if (day.week === 0 || day.week === 4) {
        const t = jitter(rng, hm(21, 0), 10);
        legs.push({ to: 'friend', leave: t }, { to: 'home', leave: t + 145 });
      } else if (day.week === 2) {
        const t = jitter(rng, hm(21, 30), 10);
        legs.push({ to: 'restaurant', leave: t }, { to: 'home', leave: t + 130 });
      }
    } else {
      if (day.week === 1 || day.week === 4) {
        const t = jitter(rng, hm(18, 30), 10);
        legs.push({ to: 'park', leave: t }, { to: 'home', leave: t + 120 });
      } else if (day.week === 2) {
        const t = jitter(rng, hm(12, 0), 10);
        legs.push({ to: 'beach', leave: t }, { to: 'home', leave: t + 240 });
      } else if (day.week === 0) {
        const t = jitter(rng, hm(13, 0), 10);
        legs.push({ to: 'winery', leave: t }, { to: 'home', leave: t + 150 });
      }
    }
    return legs;
  },
};

const ATHENS: CityDef = {
  slug: 'athens',
  city: 'Athens, Greece',
  country: 'GR',
  timeZone: 'Europe/Athens',
  cameraMode: 'simulated',
  persona: 'Nikos, an office worker living in Nea Smyrni, Athens',
  blurb:
    'Hypothetical cameras at every major junction (only a handful of ALPRs are mapped in Athens so far).',
  places: {
    home: { name: 'Home (Nea Smyrni)', label: 'home', at: [37.9475, 23.711] },
    work: {
      name: 'Office (Kifisias Avenue, Marousi)',
      label: 'work',
      at: [38.0452, 23.8063],
      park: [38.04495, 23.80575],
    },
    gym: { name: 'Gym (Palaio Faliro)', label: 'recurring', at: [37.92906, 23.6928] },
    grocery: { name: 'Supermarket (Agios Dimitrios)', label: 'recurring', at: [37.939, 23.73] },
    friend: { name: "Friend's place (Chalandri)", label: 'recurring', at: [38.0205, 23.799] },
    park: {
      name: 'Stavros Niarchos Park (Faliro)',
      label: 'recurring',
      at: [37.94104, 23.69331],
      park: [37.9405, 23.696],
    },
    rally: {
      name: 'Rally at Syntagma Square',
      label: 'rare',
      at: [37.97552, 23.73495],
      park: [37.9775, 23.7385],
      sensitive: true,
    },
    restaurant: { name: 'Taverna (Psyrri)', label: 'rare', at: [37.97842, 23.72494] },
    beach: { name: 'Beach (Vouliagmeni)', label: 'rare', at: [37.80916, 23.7736] },
    mall: { name: 'Shopping centre (The Mall Athens)', label: 'rare', at: [38.0446, 23.79048] },
    nafplio: { name: 'Weekend away (Nafplio)', label: 'rare', at: [37.56602, 22.79682] },
  },
  plan(day, rng) {
    const legs: Leg[] = [];
    const wd = day.weekday;
    if (day.iso === '2026-09-19') return [{ to: 'nafplio', leave: jitter(rng, hm(9, 30), 10) }];
    if (day.iso === '2026-09-20') return [{ to: 'home', leave: jitter(rng, hm(17, 0), 15) }];
    if (wd <= 4) {
      legs.push({ to: 'work', leave: jitter(rng, hm(7, 55), 15) });
      const leaveWork = jitter(rng, hm(17, 10), 15);
      if (day.iso === '2026-09-16') {
        // The one-off: an evening rally at Syntagma, ~18 days before the data ends.
        legs.push({ to: 'rally', leave: jitter(rng, hm(17, 50), 5) });
        legs.push({ to: 'home', leave: jitter(rng, hm(21, 0), 5) });
      } else if (wd === 0 || wd === 2 || (wd === 4 && day.week % 2 === 1)) {
        legs.push({ to: 'gym', leave: leaveWork });
        legs.push({ to: 'home', leave: leaveWork + 45 + Math.round(rng.range(60, 75)) });
      } else {
        legs.push({ to: 'home', leave: leaveWork });
      }
    } else if (wd === 5) {
      const shop = jitter(rng, hm(10, 45), 20);
      legs.push(
        { to: 'grocery', leave: shop },
        { to: 'home', leave: shop + Math.round(rng.range(45, 60)) },
      );
      // (week 2's weekend is the Nafplio trip)
      if (day.week === 0 || day.week === 3) {
        const t = jitter(rng, hm(20, 30), 10);
        legs.push({ to: 'friend', leave: t }, { to: 'home', leave: t + 150 });
      } else if (day.week === 1) {
        const t = jitter(rng, hm(21, 0), 10);
        legs.push({ to: 'restaurant', leave: t }, { to: 'home', leave: t + 130 });
      }
    } else {
      if (day.week === 0 || day.week === 3) {
        const t = jitter(rng, hm(18, 0), 10);
        legs.push({ to: 'park', leave: t }, { to: 'home', leave: t + 120 });
      } else if (day.week === 1) {
        const t = jitter(rng, hm(11, 30), 10);
        legs.push({ to: 'beach', leave: t }, { to: 'home', leave: t + 240 });
      } else if (day.week === 4) {
        const t = jitter(rng, hm(12, 30), 10);
        legs.push({ to: 'mall', leave: t }, { to: 'home', leave: t + 150 });
      }
    }
    return legs;
  },
};

/** The first city is the main sample on the start screen. */
export const CITIES = [ATHENS, THESSALONIKI, PATRAS];

// Track synthesis

type Stay = { place: string; arrive: number; depart: number };

class Recorder {
  readonly points: TrackPoint[] = [];
  constructor(private readonly rng: Rng) {}

  private push(lat: number, lon: number, t: number, noiseM: number) {
    const dLat = this.rng.normal(noiseM) / 111_320;
    const dLon = this.rng.normal(noiseM) / (111_320 * Math.cos((lat * Math.PI) / 180));
    const last = this.points[this.points.length - 1];
    if (last && t <= last.t) return;
    this.points.push({
      lat: round6(lat + dLat),
      lon: round6(lon + dLon),
      t: Math.round(t / 1000) * 1000,
    });
  }

  /** Phone sitting indoors: one fix every 5 minutes with indoor-ish noise. */
  stay(at: LL, from: number, to: number) {
    for (let t = from; t < to; t += 5 * MINUTE) this.push(at[0], at[1], t, 8);
  }

  /** Walk in a straight line at ~4.7 km/h, one fix every 10 s. Returns arrival time. */
  walk(a: LL, b: LL, start: number): number {
    const dist = haversineM({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
    const dur = (dist / 1.3) * 1000;
    for (let t = 0; t < dur; t += 10_000) {
      const u = t / dur;
      this.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, start + t, 4);
    }
    return start + dur;
  }

  /** Drive a routed path, one fix every 5 s, with traffic and a few red lights. Returns arrival time. */
  drive(route: Route, start: number, traffic: number): number {
    const { coords } = route;
    // Cumulative time at each vertex (s), slowed by traffic, plus red-light pauses.
    const cum: number[] = [0];
    const stops = new Map<number, number>();
    const nStops = Math.floor(this.rng.range(0, 4));
    for (let k = 0; k < nStops; k++)
      stops.set(Math.floor(this.rng.range(0.15, 0.9) * coords.length), this.rng.range(15, 50));
    for (let i = 1; i < coords.length; i++) {
      const base = route.durations[i - 1] ?? 0;
      cum.push(cum[i - 1]! + base * traffic + (stops.get(i) ?? 0));
    }
    const total = cum[cum.length - 1]!;
    let seg = 1;
    for (let s = 0; s <= total; s += 5) {
      while (seg < coords.length - 1 && cum[seg]! < s) seg++;
      const t0 = cum[seg - 1]!;
      const t1 = cum[seg]!;
      const pause = stops.get(seg) ?? 0;
      // Red lights happen at the start of the segment.
      const moveStart = t0 + pause;
      const u = t1 <= moveStart ? 1 : Math.max(0, Math.min(1, (s - moveStart) / (t1 - moveStart)));
      const a = coords[seg - 1]!;
      const b = coords[seg]!;
      this.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, start + s * 1000, 3);
    }
    return start + total * 1000;
  }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

function dayInfo(index: number): DayInfo {
  const base = Date.UTC(START.y, START.m - 1, START.d) + index * DAY;
  const dt = new Date(base);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return {
    index,
    week: Math.floor(index / 7),
    weekday: (dt.getUTCDay() + 6) % 7,
    y,
    m,
    d,
    iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

async function generate(city: CityDef) {
  console.log(`\n${city.city}`);
  const rng = makeRng(
    { thessaloniki: 20260901, patras: 20260902, athens: 20260903 }[city.slug] ?? 1,
  );
  const rec = new Recorder(rng);
  const stays: Stay[] = [];
  const first = dayInfo(0);
  const startT = zonedTimeToUtc(first.y, first.m, first.d, 0, city.timeZone);
  const lastDay = dayInfo(DAYS - 1);
  const endT = zonedTimeToUtc(lastDay.y, lastDay.m, lastDay.d, hm(23, 30), city.timeZone);

  let cur = 'home';
  let since = startT;
  for (let i = 0; i < DAYS; i++) {
    const day = dayInfo(i);
    for (const leg of city.plan(day, rng)) {
      const leave =
        zonedTimeToUtc(day.y, day.m, day.d, leg.leave, city.timeZone) +
        Math.round(rng.range(0, 59)) * 1000;
      if (leave <= since) throw new Error(`${day.iso}: leg to ${leg.to} leaves before arriving`);
      const from = city.places[cur]!;
      const to = city.places[leg.to]!;
      rec.stay(from.at, since, leave);
      stays.push({ place: cur, arrive: since, depart: leave });
      let t = leave;
      if (from.park) t = rec.walk(from.at, from.park, t);
      const route = await osrmRoute(from.park ?? from.at, to.park ?? to.at);
      const lt = localTime(t, city.timeZone);
      const rush =
        lt.weekday <= 4 &&
        ((lt.minutes > hm(7, 30) && lt.minutes < hm(9, 30)) ||
          (lt.minutes > hm(16, 30) && lt.minutes < hm(18, 30)));
      t = rec.drive(route, t, rush ? rng.range(1.15, 1.4) : rng.range(0.95, 1.12));
      if (to.park) t = rec.walk(to.park, to.at, t + 30_000);
      cur = leg.to;
      since = t;
    }
  }
  rec.stay(city.places[cur]!.at, since, endT);
  stays.push({ place: cur, arrive: since, depart: endT });

  const outDir = join(ROOT, 'public', 'demo', city.slug);
  if (existsSync(outDir))
    for (const f of readdirSync(outDir)) if (f.endsWith('.gpx')) rmSync(join(outDir, f));
  mkdirSync(outDir, { recursive: true });

  // One GPX file per local day, the way many loggers and Strava export.
  const byDay = new Map<string, TrackPoint[]>();
  for (const p of rec.points) {
    const k = localTime(p.t, city.timeZone).dayKey;
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(p);
  }
  const files: string[] = [];
  for (const [k, pts] of byDay) {
    const name = `${k}.gpx`;
    files.push(name);
    writeFileSync(join(outDir, name), toGpx(k, pts));
  }

  const truth = buildTruth(city, stays, startT, endT);
  writeFileSync(join(outDir, 'truth.json'), JSON.stringify(truth, null, 1) + '\n');
  const size = files.reduce((s, f) => s + readFileSync(join(outDir, f)).length, 0);
  console.log(
    `  ${rec.points.length} points in ${files.length} files (${(size / 1e6).toFixed(1)} MB)`,
  );
  return { files, points: rec.points, startT, endT };
}

function toGpx(dayKey: string, pts: TrackPoint[]): string {
  const rows = pts.map(
    (p) =>
      `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.t).toISOString().replace('.000Z', 'Z')}</time></trkpt>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="plate-trail make-demo (synthetic persona, not a real person)" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `<metadata><name>Synthetic demo track ${dayKey}</name></metadata>\n` +
    `<trk><name>${dayKey}</name><trkseg>\n${rows.join('\n')}\n</trkseg></trk>\n</gpx>\n`
  );
}

// Truth.json

function stat(values: number[]): TimeStat | undefined {
  if (!values.length) return undefined;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return {
    meanMin: Math.round(mean * 10) / 10,
    stdMin: Math.round(sd * 10) / 10,
    n: values.length,
  };
}

function buildTruth(city: CityDef, stays: Stay[], startT: number, endT: number): Truth {
  const places: TruthPlace[] = Object.entries(city.places)
    .map(([id, p]) => ({
      id,
      label: p.label,
      lat: p.at[0],
      lon: p.at[1],
      name: p.name,
      ...(p.sensitive ? { sensitive: true } : {}),
      visits: stays
        .filter((s) => s.place === id)
        .map((s) => ({ arrive: s.arrive, depart: s.depart })),
    }))
    .filter((p) => p.visits.length > 0);

  // The persona's real schedule, per weekday.
  const perDay = new Map<
    string,
    {
      weekday: number;
      leaveHome?: number;
      arriveWork?: number;
      leaveWork?: number;
      returnHome?: number;
    }
  >();
  const tz = city.timeZone;
  const dayOf = (t: number) => {
    const lt = localTime(t, tz);
    let e = perDay.get(lt.dayKey);
    if (!e) perDay.set(lt.dayKey, (e = { weekday: lt.weekday }));
    return { e, min: lt.minutes };
  };
  for (const s of stays) {
    if (s.place === 'home') {
      const dep = dayOf(s.depart);
      if (dep.min >= hm(4) && dep.min <= hm(13) && dep.e.leaveHome === undefined)
        dep.e.leaveHome = dep.min;
    }
    if (s.place === 'work') {
      const arr = dayOf(s.arrive);
      if (arr.e.arriveWork === undefined) arr.e.arriveWork = arr.min;
      dayOf(s.depart).e.leaveWork = dayOf(s.depart).min;
    }
  }
  for (const s of stays) {
    if (s.place !== 'home') continue;
    const arr = dayOf(s.arrive);
    if (
      arr.e.leaveWork !== undefined &&
      arr.min > arr.e.leaveWork &&
      arr.e.returnHome === undefined
    )
      arr.e.returnHome = arr.min;
  }
  const schedule: ScheduleRow[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const days = [...perDay.values()].filter((d) => d.weekday === wd);
    const pick = (k: 'leaveHome' | 'arriveWork' | 'leaveWork' | 'returnHome') =>
      stat(days.map((d) => d[k]).filter((v): v is number => v !== undefined));
    const row: ScheduleRow = { weekday: wd, days: days.length };
    const lh = pick('leaveHome');
    const aw = pick('arriveWork');
    const lw = pick('leaveWork');
    const rh = pick('returnHome');
    if (lh) row.leaveHome = lh;
    if (aw) row.arriveWork = aw;
    if (lw) row.leaveWork = lw;
    if (rh) row.returnHome = rh;
    schedule.push(row);
  }

  return {
    city: city.city,
    timeZone: tz,
    start: startT,
    end: endT,
    persona: city.persona,
    places,
    schedule,
  };
}

// OSM snapshots

/**
 * Public OSM data for the same coarse cells the app would request for this track, saved so the
 * demo works in one click even when the shared Overpass servers are busy. ODbL, © OSM contributors.
 */
async function snapshotOsm(city: CityDef, points: TrackPoint[], force: boolean) {
  const outDir = join(ROOT, 'public', 'demo', city.slug);
  const cells = cellsForPoints(points);
  if (!force) {
    try {
      const have = (f: string) =>
        new Set((JSON.parse(readFileSync(join(outDir, f), 'utf8')) as { cells: string[] }).cells);
      const cams = have('cameras.json');
      const juncs = have('junctions.json');
      if (cells.every((c) => cams.has(c) && juncs.has(c))) {
        console.log('  OSM snapshot already covers this track (add refresh-osm to re-download)');
        return;
      }
    } catch {
      // no usable snapshot yet
    }
  }
  const endpoints = [OVERPASS_ENDPOINTS[1]!, OVERPASS_ENDPOINTS[0]!, OVERPASS_ENDPOINTS[2]!];
  const opts = {
    endpoints,
    userAgent: USER_AGENT,
    attempts: 3,
    backoffMs: 5000,
    onStatus: (m: string) => console.log('   ', m),
  };
  console.log(`  OSM snapshot for ${cells.length} cells`);

  // Every finished query is cached on disk, so a run that the busy public servers cut short
  // resumes where it stopped instead of starting over.
  const cacheDir = join(ROOT, 'scripts', '.cache', 'osm-cells');
  mkdirSync(cacheDir, { recursive: true });
  const cached = <T>(name: string): T | null => {
    const f = join(cacheDir, name);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
  };
  const patiently = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (e) {
        if (attempt >= 5) throw e;
        console.log(`    ${what}: ${(e as Error).message.slice(0, 90)}, waiting ${attempt * 30} s`);
        await new Promise((r) => setTimeout(r, attempt * 30_000));
      }
    }
  };

  const camKey = `alpr-${city.slug}-${cells.length}-${cells[0]}-${cells[cells.length - 1]}.json`;
  let cameras = cached<Camera[]>(camKey);
  if (!cameras) {
    const resp = await patiently('cameras', () => overpassFetch(alprQuery(cells), opts));
    cameras = camerasFromOverpass(resp);
    writeFileSync(join(cacheDir, camKey), JSON.stringify(cameras));
  }
  console.log(`  ${cameras.length} mapped ALPR cameras`);

  const junctions: JunctionCandidate[] = [];
  const seen = new Set<number>();
  // Gentle on the shared servers: three cells per request, each cell cached once done.
  const todo = cells.filter((c) => !existsSync(join(cacheDir, `roads-${c}.json`)));
  for (let i = 0; i < todo.length; i += 3) {
    const chunk = todo.slice(i, i + 3);
    const resp = await patiently('roads', () => overpassFetch(roadsQuery(chunk), opts));
    const byCell = new Map<string, JunctionCandidate[]>(chunk.map((c) => [c, []]));
    for (const j of junctionCandidatesFromOverpass(resp))
      byCell.get(cellKey(j.lat, j.lon))?.push(j);
    for (const [c, list] of byCell)
      writeFileSync(join(cacheDir, `roads-${c}.json`), JSON.stringify(list));
    console.log(
      `  roads: ${cells.length - todo.length + Math.min(i + 3, todo.length)}/${cells.length} cells`,
    );
  }
  for (const c of cells)
    for (const j of cached<JunctionCandidate[]>(`roads-${c}.json`) ?? [])
      if (!seen.has(j.id)) {
        seen.add(j.id);
        junctions.push(j);
      }
  junctions.sort((a, b) => a.id - b.id);
  console.log(`\n  ${junctions.length} junction candidates`);
  const fetchedAt = new Date().toISOString();
  const compact = junctions.map((j) => ({
    id: j.id,
    lat: round6(j.lat),
    lon: round6(j.lon),
    roads: j.roads,
  }));
  writeFileSync(
    join(outDir, 'cameras.json'),
    JSON.stringify({ fetchedAt, cellDeg: 0.1, cells, cameras }) + '\n',
  );
  writeFileSync(
    join(outDir, 'junctions.json'),
    JSON.stringify({ fetchedAt, cellDeg: 0.1, cells, junctions: compact }) + '\n',
  );
}

// Main

async function main() {
  const args = process.argv.slice(2);
  const skipOsm = args.includes('no-osm');
  const forceOsm = args.includes('refresh-osm');
  const only = args.filter((a) => a !== 'no-osm' && a !== 'refresh-osm');
  const manifestPath = join(ROOT, 'public', 'demo', 'index.json');
  for (const city of CITIES) {
    if (only.length && !only.includes(city.slug)) continue;
    const { points } = await generate(city);
    if (!skipOsm) await snapshotOsm(city, points, forceOsm);
  }
  const manifest = CITIES.map((c) => {
    const dir = join(ROOT, 'public', 'demo', c.slug);
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.gpx'))
          .sort()
      : [];
    return {
      slug: c.slug,
      city: c.city,
      country: c.country,
      timeZone: c.timeZone,
      cameraMode: c.cameraMode,
      persona: c.persona,
      blurb: c.blurb,
      files,
    };
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
  console.log('\nwrote', manifestPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
