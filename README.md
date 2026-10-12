# Plate Trail

**The trail your number plate leaves behind, and how long the cameras keep it.**

What would a licence-plate camera network learn about your week, and how much does the data-retention period change that?

![Replay of the Atlanta sample: cameras light up as the car passes, the shaded retention window slides along the timeline, and the observer’s notebook fills in home, work and routine.](docs/replay.gif)

**Website:** https://kats0ulas.github.io/plate-trail/ (online while this repository is public) · runs entirely in your browser · MIT licence

Load your own GPS history (GPX, TCX or KML) or click **Try the sample week**. The app places automatic licence-plate reader (ALPR) cameras on the map: real ones mapped in OpenStreetMap, or hypothetical ones at every major junction. It replays the drives the way the camera network would record them, and lets an “observer” work out home, workplace, routine and rare one-off visits from the camera reads alone. A retention selector limits what the observer can still see, and **Reveal the truth** grades every guess against what really happened.

The point it makes: **the retention period decides how much of a life can be reconstructed.**

It is a simulation. No real camera records and no number plates are used.

## Your data never leaves your browser

- **No backend.** No accounts, analytics, telemetry or error reporting. Parsing and analysis run on your device, in a Web Worker.
- **Nothing is stored.** Your track and the results never touch cookies, `localStorage` or IndexedDB. Close the tab and they are gone. (Public camera and road data is cached in memory only.)
- **Only two kinds of request leave the page:** map tiles and style from `tiles.openfreemap.org`, and camera and road data from the public Overpass API. A Content Security Policy in [`index.html`](index.html) enforces this (`connect-src` lists exactly those hosts) and a test keeps it that way.
- **Coarse queries.** Overpass is never sent your route or its bounding box. The app asks for whole 0.1° grid cells (about 10 km) that your track touches, plus their neighbours, in one request. Honestly: _your track stays in your browser; the tile server and Overpass only learn roughly which area (about city level) you are looking at._
- **Check it yourself:** open the browser’s Network tab, load a file, and watch.
- The samples load a saved copy of the same public OSM data from this site, so the one-click demo works even when the shared Overpass servers are busy. “Refresh from OpenStreetMap” fetches it live.

## How it works

```mermaid
flowchart LR
  A[GPX, TCX or KML files] ==>|parse, merge, clean<br/>on this device| B[Track points]
  C[(OSM: mapped ALPRs<br/>or major junctions)] ==> D
  B ==> D[Detection<br/>within 30 m, at vehicle speed]
  D ==> E[Camera reads<br/>camera · time · heading]
  E ==> F{Retention window<br/>T minus r ≤ t ≤ T}
  F ==> G[Observer<br/>trips → stays → clusters → labels]
  G ==> H[Home · Work · Routine · Rare visits<br/>with evidence]
  B ==>|full track, only for grading| I[Ground truth<br/>stay points → same labels]
  I ==> J{Reveal the truth<br/>hit if within 500 m}
  H ==> J
```

1. **Cameras.** Real: nodes and ways tagged `surveillance:type=ALPR` in OpenStreetMap. Simulated: a junction is a node shared by ways of _different_ roads (different `name` or `ref`), so a road that OSM splits into two ways does not count. Nodes within 30 m merge, and a seeded coverage percentage and minimum spacing pick which junctions get a hypothetical camera.
2. **Detection.** For every pair of consecutive GPS points, every camera within the read radius (default 30 m) of that segment logs a read at the interpolated moment of closest approach. Only driving counts (15 to 200 km/h, or slower traffic within 45 s of driving at that speed): ALPRs read plates, so walking produces nothing. Reads of the same camera within 2 minutes count once.
3. **Retention.** At the timeline cursor _T_, the observer sees reads with `T minus retention ≤ t ≤ T` (both ends inclusive; “forever” means every read up to _T_).
4. **Observer, camera reads only.** It never receives the track (enforced by function signatures, an ESLint rule and a test that walks its import graph). Trips split at gaps over 20 minutes; the silence between two trips is a stay near the two bracketing cameras; DBSCAN clusters the stays; shared rules label Home (most time overnight), Work (weekdays 9 to 5 on 3 or more days), recurring places (stays of 30 to 150 minutes on 2 or more days at similar times) and rare visits (one stay over 45 minutes at a place never visited otherwise), plus a weekday schedule. Every inference carries its evidence.
5. **Truth.** The same labelling rules run on stay points from the full GPS track (or, for the samples, the persona’s `truth.json`). An inferred place is a hit if it is within 500 m of a true place with the same label.

All thresholds live in [`src/engine/params.ts`](src/engine/params.ts), each with a comment.

## Retention periods (as of October 2026)

<table>
<tr><th>Period</th><th>Where it comes from</th><th>Source</th></tr>
<tr><td>48 hours</td><td><b>Ban Flock Act</b> (Sen. Sanders, introduced 2 Oct 2026): bars federal ALPR use; the only exceptions (toll collection, future uses Congress approves) must cap retention at 48 hours.</td><td><a href="https://techcrunch.com/2026/10/02/sanders-introduces-bill-to-ban-the-federal-government-from-using-flock/">TechCrunch</a> · <a href="https://www.sanders.senate.gov/wp-content/uploads/Ban-Flock-Act.pdf">bill text</a></td></tr>
<tr><td>7 days</td><td><b>Flock Safety’s default</b> retention since August 2026 (lowered from 30 days).</td><td><a href="https://techcrunch.com/2026/10/02/sanders-introduces-bill-to-ban-the-federal-government-from-using-flock/">TechCrunch</a></td></tr>
<tr><td>10 days</td><td><b>Stop Flock Abuse Act</b> (Sen. Hawley): written approval for searches, deletion after ten days.</td><td><a href="https://www.404media.co/lawmakers-introduce-multiple-laws-to-curb-flock-after-404-media-coverage/">404 Media</a></td></tr>
<tr><td>21 days</td><td><b>Connecticut</b> law (Public Act 26-14, SB 397), in effect since 1 Oct 2026.</td><td><a href="https://ctmirror.org/2026/09/23/ct-laws-oct-1-ai-flock-cameras-immigration-distracted-driving/">CT Mirror</a> · <a href="https://search.cga.state.ct.us/2026/PA/pdf/2026PA-00014-R00SB-00397-PA.pdf">act</a></td></tr>
<tr><td>30 days</td><td>Flock Safety’s default <b>before</b> August 2026.</td><td><a href="https://techcrunch.com/2026/10/02/sanders-introduces-bill-to-ban-the-federal-government-from-using-flock/">TechCrunch</a></td></tr>
<tr><td>Forever</td><td>No retention limit.</td><td>none</td></tr>
</table>

Bills change. The periods are data in [`src/config/retention.ts`](src/config/retention.ts).

### What each period reveals (Atlanta sample, end of the data)

<table>
<tr><th>Retention</th><th>Camera reads visible</th><th>Real places found (of 11)</th><th>Home located to within</th><th>Routine</th><th>Rally found?</th></tr>
<tr><td>48 h (Ban Flock Act)</td><td align="right">75</td><td align="right">1</td><td align="right">121 m</td><td>none</td><td>no</td></tr>
<tr><td>7 d (Flock default)</td><td align="right">503</td><td align="right">3</td><td align="right">121 m</td><td>Medium confidence</td><td>no</td></tr>
<tr><td>10 d (Stop Flock Abuse Act)</td><td align="right">729</td><td align="right">4</td><td align="right">121 m</td><td>Medium confidence</td><td>no</td></tr>
<tr><td>21 d (Connecticut)</td><td align="right">1,639</td><td align="right">7</td><td align="right">121 m</td><td>High confidence</td><td>yes</td></tr>
<tr><td>30 d (Flock, before Aug 2026)</td><td align="right">2,270</td><td align="right">8</td><td align="right">121 m</td><td>High confidence</td><td>yes</td></tr>
<tr><td>Forever (No limit)</td><td align="right">2,702</td><td align="right">8</td><td align="right">121 m</td><td>High confidence</td><td>yes</td></tr>
</table>

The same observer, at the same moment (the end of the data), with different retention. The home is found even from 48 hours of reads: two nights are enough. The workplace and routine need about a week, and the rally only shows up once retention reaches back about 18 days. With five weeks of data, 30 days and “forever” look alike; with months of history the gap keeps growing. Regenerate with `npx tsx scripts/eval-demo.ts`.

## The sample personas

Most visitors will not upload their own location history, so the samples make the point in one click. All three are **synthetic**: invented people, five weeks of driving and walking generated along real roads (routes from the public OSRM demo server, then GPS noise and sampling), committed as one GPX file per day with a `truth.json` of the persona’s real places and schedule.

- **Atlanta, Georgia (real cameras).** One of the densest areas of ALPRs mapped in OpenStreetMap (about 3,500 in the area the persona drives through). Home in Brookhaven, office at Perimeter Center, gym, weekly supermarket, a friend’s place, a park, a weekend at Lake Lanier, and on Wednesday 16 September, about 18 days before the data ends, **a rally at the Georgia State Capitol**. It is visible with 21 days, 30 days or unlimited retention, and gone at 10 days.
- **Thessaloniki, Greece (simulated cameras).** Few ALPRs are mapped in Greece, so this one asks “what if every major junction had one?”.
- **Patras, Greece (simulated cameras).** Dimitra lives in Zarouchleika and works at the University of Patras campus in Rio: gym evenings in Agyia, Saturday shopping in Perivola, Sunday walks at the Plaz, a weekend in Nafpaktos across the Rio Antirrio bridge, and an evening rally at Plateia Georgiou A’ about 18 days before the data ends.

The places are public landmarks or arbitrary points on ordinary streets, chosen so that a camera sees the car near them; they are not anyone’s address.

## Limitations and ethics

- OpenStreetMap camera data is crowdsourced and incomplete; simulated cameras are hypothetical.
- The inference is a set of simple, documented heuristics, not what any vendor or agency actually runs.
- Real systems also record vehicle make, model and colour, and share data between agencies and jurisdictions, so the real picture can be worse.
- Only use this on your own data. Not legal advice.
- Strava and similar apps only record workouts, not your whole day. For a realistic result use a continuous logger (for example GPSLogger on Android, or OsmAnd trip recording).

## Running it

Requires Node 24.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # unit and end-to-end tests (Vitest)
npm run test:coverage
npm run typecheck
npm run lint
npm run build          # static site in dist/
npm run demo           # regenerate the sample personas and OSM snapshots (uses OSRM and Overpass)
```

`npx tsx scripts/make-demo.ts atlanta` regenerates one city. The saved camera and junction snapshots are reused while they cover the track; add `refresh-osm` to download them again, or `no-osm` to skip them. Routing responses are cached in `scripts/.cache/`. `scripts/eval-demo.ts` prints how the observer does for every retention period.

**Tech:** Vite and TypeScript (strict), no UI framework (a 40-line typed store), MapLibre GL JS, OpenFreeMap (Positron), Turf (`@turf/clusters-dbscan`), `@tmcw/togeojson` (TCX and KML), Flatbush, Vitest, ESLint and Prettier, GitHub Actions to GitHub Pages.

Notes from building it:

- TypeScript is pinned to 6.0 because `typescript-eslint` does not support TypeScript 7 yet.
- MapLibre 6 has no default export and resolves its worker from its own module URL, which breaks after bundling. [`src/map/basemap.ts`](src/map/basemap.ts) imports the worker file and calls `setWorkerUrl`, so it is served from our own origin and the CSP needs no `blob:` script.
- GPX is parsed directly rather than with `@tmcw/togeojson`, which drops missing `<time>` elements without leaving a gap and so shifts later timestamps onto the wrong points. togeojson is still used for TCX and KML.
- `@tmcw/togeojson` needs `DOMParser`, which Web Workers lack, so parsing runs on the main thread; detection, inference and ground truth run in the worker.

## Credits and licences

- Code: MIT, see [LICENSE](LICENSE).
- Camera and road data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL. Saved copies in `public/demo/*/cameras.json` and `junctions.json` are ODbL.
- Basemap: [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema, © OpenMapTiles, © OpenStreetMap contributors).
- Libraries: MapLibre GL JS (BSD 3), Turf (MIT), @tmcw/togeojson (BSD 2), Flatbush (ISC), Vite, Vitest, TypeScript.
- Demo routes: [OSRM](https://project-osrm.org) public demo server, OSM data.
