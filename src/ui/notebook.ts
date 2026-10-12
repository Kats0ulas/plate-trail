import { RETENTION_PRESETS, presetById } from '../config/retention';
import { WEEKDAY_SHORT, formatClock, formatDateTime, formatDuration } from '../engine/time';
import { effectiveTimeZone, store, type AppState } from '../state';
import type { ComparisonRow, Place, PlaceLabel, PlaceScore, ScheduleRow, TimeStat } from '../types';
import { LABEL_NAMES, el, formatDistance, labelIcon } from './format';

/** Right panel: what the observer can reconstruct at T, and why. */

export function mountNotebook(
  root: HTMLElement,
  onFly: (p: { lat: number; lon: number }) => void,
): void {
  const head = el(
    'div',
    { class: 'nb-head' },
    el('h2', { class: 'panel-title' }, 'Observer’s notebook'),
  );
  const sub = el('p', { class: 'nb-sub' });
  const reveal = el('button', { type: 'button', class: 'btn reveal', 'aria-pressed': 'false' });
  reveal.addEventListener('click', () => store.set({ revealTruth: !store.get().revealTruth }));
  head.append(sub, reveal);
  const body = el('div', { class: 'panel-body', 'aria-live': 'polite', 'aria-busy': 'false' });
  root.append(head, body);

  let lastKey = '';
  const render = (s: AppState) => {
    const tz = effectiveTimeZone(s);
    const preset = presetById(s.retentionId);
    sub.textContent = s.dataset
      ? `Only camera reads from the last ${preset.hours === null ? 'forever' : preset.short} before ${formatDateTime(s.T, tz)}. Nothing else.`
      : '';
    reveal.setAttribute('aria-pressed', String(s.revealTruth));
    reveal.textContent = s.revealTruth ? 'Hide the truth' : 'Reveal the truth';
    reveal.hidden = !s.truth;

    // Avoid rebuilding the DOM when nothing visible changed (e.g. during playback).
    const key = [
      s.inference,
      s.scores,
      s.revealTruth,
      s.comparison,
      s.cameraStatus.state,
      s.retentionId,
      tz,
      s.detecting,
    ]
      .map(idOf)
      .join('|');
    if (key === lastKey) return;
    lastKey = key;
    body.replaceChildren(...content(s, tz, onFly));
  };
  store.on(
    [
      'inference',
      'scores',
      'revealTruth',
      'comparison',
      'cameraStatus',
      'retentionId',
      'T',
      'tzOverride',
      'truth',
      'detecting',
      'dataset',
    ],
    render,
    true,
  );
}

const ids = new WeakMap<object, number>();
let idCounter = 0;
function idOf(v: unknown): string {
  if (v && typeof v === 'object') {
    if (!ids.has(v)) ids.set(v, ++idCounter);
    return `o${ids.get(v)}`;
  }
  return String(v);
}

function content(
  s: AppState,
  tz: string,
  onFly: (p: { lat: number; lon: number }) => void,
): Node[] {
  if (!s.dataset) return [];
  if (s.cameraStatus.state === 'loading')
    return [el('p', { class: 'empty' }, 'Waiting for camera data…')];
  if (s.cameraStatus.state === 'error')
    return [el('p', { class: 'empty' }, 'No cameras, no observer. See Controls → Cameras.')];
  const inf = s.inference;
  if (!inf)
    return [
      el(
        'p',
        { class: 'empty' },
        s.detecting ? 'Replaying the track past the cameras…' : 'Working…',
      ),
    ];

  const out: Node[] = [];
  const stats = el(
    'dl',
    { class: 'stats' },
    stat('reads', inf.stats.reads.toLocaleString()),
    stat('cameras', inf.stats.distinctCameras.toLocaleString()),
    stat('days', inf.stats.daysCovered.toLocaleString()),
  );
  out.push(stats);
  if (inf.stats.reads === 0) {
    out.push(
      el(
        'p',
        { class: 'empty' },
        s.detections.length === 0
          ? 'The cameras never read this vehicle. Try a larger read radius, simulated cameras, or a track with more driving.'
          : 'No reads inside this retention window at this moment. Move the timeline cursor or choose a longer retention.',
      ),
    );
  }

  const scores = new Map((s.scores ?? []).map((sc) => [sc.inferredId, sc]));
  const truthById = new Map((s.truth?.places ?? []).map((t) => [t.id, t]));
  const card = (p: Place) =>
    placeCard(p, s.revealTruth ? scores.get(p.id) : undefined, truthById, tz, onFly);
  const byLabel = (l: PlaceLabel) => inf.places.filter((p) => p.label === l);

  if (s.revealTruth && s.truth) out.push(truthSummary(s));

  out.push(
    group(
      'home',
      'Home',
      byLabel('home').map(card),
      'No home yet: needs overnight gaps between reads.',
    ),
  );
  out.push(
    group(
      'work',
      'Work',
      byLabel('work').map(card),
      'No workplace yet: needs weekday daytime stays on 3+ days.',
    ),
  );
  out.push(
    group(
      'recurring',
      'Recurring places',
      byLabel('recurring').map(card),
      'None yet: needs 30–150 min stays at similar times on 2+ days.',
    ),
  );
  out.push(
    group(
      'rare',
      'Rare visits',
      byLabel('rare').map(card),
      'None: no single long stay at an otherwise unvisited place.',
    ),
  );
  out.push(
    scheduleCard(
      inf.schedule.rows,
      inf.schedule.predictability,
      inf.schedule.confidence,
      inf.schedule.evidence,
      s,
    ),
  );
  if (s.truth) out.push(comparisonTable(s, tz));
  return out;
}

function stat(label: string, value: string): HTMLElement {
  return el('div', {}, el('dt', {}, label), el('dd', {}, value));
}

function group(label: PlaceLabel, title: string, cards: HTMLElement[], empty: string): HTMLElement {
  const sec = el(
    'section',
    { class: `nb-group label-${label}` },
    el('h3', {}, el('span', { class: 'gi' }), title),
  );
  sec.querySelector('.gi')!.innerHTML = labelIcon(label, 15);
  if (cards.length) sec.append(...cards);
  else sec.append(el('p', { class: 'empty small' }, empty));
  return sec;
}

function placeCard(
  p: Place,
  score: PlaceScore | undefined,
  truthById: Map<string, { name: string; sensitive?: boolean }>,
  tz: string,
  onFly: (p: { lat: number; lon: number }) => void,
): HTMLElement {
  const conf = el(
    'span',
    { class: `badge conf-${p.confidence.toLowerCase()}` },
    `${p.confidence} confidence`,
  );
  const summary = el(
    'p',
    { class: 'card-sum' },
    `Within ± ${formatDistance(p.radiusM)} · ${p.visits} stay${p.visits === 1 ? '' : 's'} on ${p.days} day${p.days === 1 ? '' : 's'} · ${formatDuration(p.totalDwellMs)} in total`,
  );
  const fly = el('button', { type: 'button', class: 'linkish' }, 'Show on map');
  fly.addEventListener('click', () => onFly(p));
  const why = el(
    'details',
    { class: 'why' },
    el('summary', {}, 'Why we think this'),
    el('ul', {}, ...p.evidence.map((e) => el('li', {}, e))),
    el(
      'p',
      { class: 'hint' },
      `First read ${formatDateTime(p.firstSeen, tz)}, last ${formatDateTime(p.lastSeen, tz)}.`,
    ),
  );
  const card = el(
    'article',
    { class: `card label-${p.label}`, id: `card-${p.id}` },
    el('div', { class: 'card-top' }, conf, fly),
    summary,
  );
  if (score) {
    const t = score.truthId ? truthById.get(score.truthId) : undefined;
    card.append(
      el(
        'p',
        { class: `verdict ${score.hit ? 'hit' : 'miss'}` },
        score.hit
          ? `✓ Correct: ${t?.name ?? 'a real place'}, ${formatDistance(score.errorM ?? 0)} away.`
          : score.errorM !== null
            ? `✗ Wrong: the nearest real ${LABEL_NAMES[p.label].toLowerCase()} is ${formatDistance(score.errorM)} away.`
            : `✗ Wrong: there is no real ${LABEL_NAMES[p.label].toLowerCase()} like this.`,
      ),
    );
    if (score.hit && t?.sensitive)
      card.append(el('p', { class: 'verdict sensitive' }, 'This is the sensitive one-off visit.'));
  }
  card.append(why);
  return card;
}

function truthSummary(s: AppState): HTMLElement {
  const inf = s.inference!;
  const scores = s.scores ?? [];
  const lines: Node[] = [];
  const truthById = new Map(s.truth!.places.map((t) => [t.id, t]));
  for (const label of ['home', 'work'] as const) {
    const p = inf.places.find((x) => x.label === label);
    const sc = p && scores.find((x) => x.inferredId === p.id);
    const word = label === 'home' ? 'home' : 'workplace';
    if (p && sc?.hit)
      lines.push(
        el(
          'li',
          {},
          `The observer located your ${word} to within ${formatDistance(sc.errorM ?? 0)}, from ${p.visits} stay${p.visits === 1 ? '' : 's'} between camera reads.`,
        ),
      );
    else if (s.truth!.places.some((t) => t.label === label))
      lines.push(el('li', {}, `Your ${word} was not found from these reads.`));
  }
  const found = new Set(scores.filter((x) => x.hit && x.truthId).map((x) => x.truthId!));
  const sensitive = s.truth!.places.find((t) => t.sensitive);
  if (sensitive)
    lines.push(
      el(
        'li',
        { class: found.has(sensitive.id) ? 'warn' : '' },
        found.has(sensitive.id)
          ? `It found the one-off visit: ${sensitive.name}.`
          : `It did not find the one-off visit (${sensitive.name}) — the reads from that evening are ${
              presetById(s.retentionId).hours === null
                ? 'not enough'
                : 'outside this retention window or too sparse'
            }.`,
      ),
    );
  lines.push(
    el(
      'li',
      {},
      `${found.size} of ${s.truth!.places.length} real places identified; ${scores.filter((x) => !x.hit).length} wrong guesses.`,
    ),
  );
  const misses = s.truth!.places.filter((t) => !found.has(t.id)).map((t) => t.name);
  const box = el(
    'section',
    { class: 'truth-box' },
    el(
      'h3',
      {},
      s.truth!.source === 'persona'
        ? 'The truth (the persona’s real week)'
        : 'The truth (from your full GPS track)',
    ),
    el('ul', {}, ...lines),
  );
  if (misses.length) box.append(el('p', { class: 'hint' }, `Not found: ${misses.join(', ')}.`));
  void truthById;
  return box;
}

function fmtStat(s: TimeStat | undefined): string {
  if (!s) return '—';
  return s.n > 1 ? `${formatClock(s.meanMin)} ±${Math.round(s.stdMin)}` : formatClock(s.meanMin);
}

function scheduleCard(
  rows: ScheduleRow[],
  predictability: number,
  confidence: string,
  evidence: string[],
  s: AppState,
): HTMLElement {
  const sec = el('section', { class: 'nb-group schedule' }, el('h3', {}, 'Daily schedule'));
  const any = rows.some((r) => r.leaveHome || r.arriveWork || r.leaveWork || r.returnHome);
  if (!any) {
    sec.append(el('p', { class: 'empty small' }, 'No routine yet: needs a home and a workplace.'));
    return sec;
  }
  const table = el(
    'table',
    { class: 'sched' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, ''),
        el('th', { scope: 'col' }, 'Leave home'),
        el('th', { scope: 'col' }, 'At work'),
        el('th', { scope: 'col' }, 'Leave work'),
        el('th', { scope: 'col' }, 'Home'),
      ),
    ),
    el(
      'tbody',
      {},
      ...rows
        .filter((r) => r.days > 0)
        .map((r) =>
          el(
            'tr',
            {},
            el('th', { scope: 'row' }, WEEKDAY_SHORT[r.weekday]!),
            el('td', {}, fmtStat(r.leaveHome)),
            el('td', {}, fmtStat(r.arriveWork)),
            el('td', {}, fmtStat(r.leaveWork)),
            el('td', {}, fmtStat(r.returnHome)),
          ),
        ),
    ),
  );
  const meter = el('div', {
    class: 'meter',
    role: 'meter',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(predictability),
    'aria-label': 'Routine predictability',
  });
  const fill = el('div', { class: 'meter-fill' });
  fill.style.width = `${predictability}%`;
  meter.append(fill);
  sec.append(
    el(
      'div',
      { class: 'card-top' },
      el('span', { class: `badge conf-${confidence.toLowerCase()}` }, `${confidence} confidence`),
    ),
    el('p', { class: 'card-sum' }, `Routine predictability: ${predictability}/100`),
    meter,
    table,
    el(
      'p',
      { class: 'hint' },
      'Times are when the cameras read the car (mean ± minutes), not the exact moment of leaving.',
    ),
    el(
      'details',
      { class: 'why' },
      el('summary', {}, 'Why we think this'),
      el('ul', {}, ...evidence.map((e) => el('li', {}, e))),
    ),
  );
  if (s.revealTruth && s.truth?.source === 'persona')
    sec.append(el('p', { class: 'hint' }, 'Compare: the persona’s real times are in truth.json.'));
  return sec;
}

function comparisonTable(s: AppState, tz: string): HTMLElement {
  const sec = el('section', { class: 'nb-group compare' }, el('h3', {}, 'Retention comparison'));
  const rows = s.comparison;
  if (!rows) {
    sec.append(
      el(
        'p',
        { class: 'empty small' },
        s.playing ? 'Paused replays update this table.' : 'Comparing…',
      ),
    );
    return sec;
  }
  sec.append(
    el(
      'p',
      { class: 'hint' },
      `Same observer, same moment (${formatDateTime(s.comparisonT ?? s.T, tz)}), different retention. A place counts as found within 500 m of the real one.`,
    ),
  );
  const maxFound = Math.max(1, ...rows.map((r) => r.placesTotal));
  const table = el(
    'table',
    { class: 'cmp' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'Kept'),
        el('th', { scope: 'col' }, 'Reads'),
        el('th', { scope: 'col' }, 'Found'),
        el('th', { scope: 'col' }, 'Home error'),
        el('th', { scope: 'col' }, 'Routine'),
      ),
    ),
    el('tbody', {}, ...rows.map((r) => cmpRow(r, s, maxFound))),
  );
  sec.append(table);
  return sec;
}

function cmpRow(r: ComparisonRow, s: AppState, maxFound: number): HTMLElement {
  const p = RETENTION_PRESETS.find((x) => x.id === r.presetId)!;
  const bar = el('span', { class: 'bar' });
  const fill = el('span', { class: 'bar-fill' });
  fill.style.width = `${(r.placesFound / maxFound) * 100}%`;
  bar.append(fill);
  const sensitive = s.truth?.places.find((t) => t.sensitive);
  const btn = el(
    'button',
    { type: 'button', class: 'linkish', title: `Switch to ${p.short} (${p.source})` },
    p.short,
  );
  btn.addEventListener('click', () => store.set({ retentionId: p.id }));
  return el(
    'tr',
    { class: r.presetId === s.retentionId ? 'current' : '' },
    el('th', { scope: 'row' }, btn, el('span', { class: 'src' }, p.source)),
    el('td', {}, r.reads.toLocaleString()),
    el(
      'td',
      { class: 'found' },
      bar,
      ` ${r.placesFound}/${r.placesTotal}`,
      sensitive && r.foundLabels.includes(sensitive.id)
        ? el('span', { class: 'flag', title: `Includes ${sensitive.name}` }, ' ⚑')
        : '',
    ),
    el('td', {}, r.homeErrorM === null ? '—' : formatDistance(r.homeErrorM)),
    el('td', {}, r.scheduleConfidence ?? '—'),
  );
}
