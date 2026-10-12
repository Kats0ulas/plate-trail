/**
 * Dev tool: run the full pipeline on a demo persona and print how well the observer does
 * at the end of the data for every retention preset.   npx tsx scripts/eval-demo.ts atlanta
 */
import { RETENTION_PRESETS } from '../src/config/retention';
import { detect } from '../src/engine/detection';
import { groundTruthFromTrack } from '../src/engine/ground-truth';
import { inferFromDetections } from '../src/engine/observer';
import { defaultEngineParams } from '../src/engine/params';
import { visibleDetections } from '../src/engine/retention';
import { compareRetention, scorePlaces } from '../src/engine/scoring';
import { formatClock } from '../src/engine/time';
import { demoCameras, loadDemoTrack, loadManifest, loadTruth } from '../tests/load-demo';

for (const entry of loadManifest()) {
  if (process.argv[2] && process.argv[2] !== entry.slug) continue;
  const t0 = performance.now();
  const track = loadDemoTrack(entry.slug);
  const truth = loadTruth(entry.slug);
  const cams = demoCameras(entry.slug, entry.cameraMode);
  const p = defaultEngineParams();
  const t1 = performance.now();
  const reads = detect(track, cams, p.detection);
  const t2 = performance.now();
  const T = track[track.length - 1]!.t;
  console.log(
    `\n== ${entry.slug}: ${track.length} pts, ${cams.length} cameras, ${reads.length} reads (${new Set(reads.map((r) => r.cameraId)).size} cameras), load ${Math.round(t1 - t0)} ms, detect ${Math.round(t2 - t1)} ms`,
  );
  const gt = groundTruthFromTrack(track, p, truth.timeZone);
  const gtScores = scorePlaces(gt.places, truth.places, 500);
  console.log(
    'ground truth:',
    gt.places
      .map(
        (pl, i) =>
          `${pl.label}${gtScores[i]!.hit ? '✓' : '✗'}(${gtScores[i]!.errorM}m ${gtScores[i]!.truthId})`,
      )
      .join(' '),
  );
  const rows = compareRetention(
    reads,
    cams,
    T,
    RETENTION_PRESETS,
    p,
    truth.timeZone,
    truth.places,
    500,
  );
  for (const r of rows) {
    const vis = visibleDetections(
      reads,
      T,
      RETENTION_PRESETS.find((x) => x.id === r.presetId)!.hours,
    );
    const res = inferFromDetections(vis, cams, p, truth.timeZone);
    const sc = scorePlaces(res.places, truth.places, 500);
    console.log(
      `${r.presetId.padEnd(8)} reads ${String(r.reads).padStart(5)} found ${r.placesFound}/${r.placesTotal} err ${r.meanErrorM}m home ${r.homeErrorM}m sched ${r.scheduleConfidence}(${r.predictability}) | ` +
        res.places
          .map(
            (pl, i) =>
              `${pl.label[0]}${sc[i]!.hit ? '✓' : '✗'}${sc[i]!.truthId ?? ''}:${sc[i]!.errorM}m/r${pl.radiusM}/${pl.confidence[0]}`,
          )
          .join(' '),
    );
    if (r.presetId === '21d') {
      for (const row of res.schedule.rows)
        if (row.leaveHome)
          console.log(
            `   wd${row.weekday} leave ${formatClock(row.leaveHome.meanMin)}±${row.leaveHome.stdMin} n${row.leaveHome.n}`,
          );
      console.log('  ', res.schedule.evidence.join('\n   '));
      for (const pl of res.places) console.log(`   [${pl.label}] ${pl.evidence.join(' / ')}`);
    }
  }
}
