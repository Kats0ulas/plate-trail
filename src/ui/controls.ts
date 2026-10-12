import { RETENTION_AS_OF, RETENTION_PRESETS, presetById } from '../config/retention';
import { refreshCameras } from '../app';
import { ALL_ROAD_CLASSES, DETECTION_DEFAULTS, type RoadClass } from '../engine/params';
import { browserTimeZone, formatDateTime } from '../engine/time';
import { effectiveTimeZone, store, type AppState, type CameraMode } from '../state';
import { el } from './format';

/** Left panel: everything the visitor can change. Re-rendered from the store. */

export function mountControls(root: HTMLElement, openFilePicker: () => void): void {
  root.append(el('h2', { class: 'panel-title' }, 'Controls'));
  const body = el('div', { class: 'panel-body' });
  root.append(body);

  // Retention (the key control)
  const retention = section(
    'Retention period',
    'How long camera reads are kept before deletion. As of ' + RETENTION_AS_OF + '.',
  );
  const seg = el('div', {
    class: 'segmented retention',
    role: 'radiogroup',
    'aria-label': 'Retention period',
  });
  for (const p of RETENTION_PRESETS) {
    const b = el(
      'button',
      { type: 'button', role: 'radio', 'data-id': p.id, title: p.description },
      el('span', { class: 'seg-main' }, p.short),
      el('span', { class: 'seg-sub' }, p.source),
    );
    b.addEventListener('click', () => store.set({ retentionId: p.id }));
    seg.append(b);
  }
  seg.addEventListener('keydown', (e) => radioKeys(e, seg));
  const retentionNote = el('p', { class: 'hint' });
  retention.append(seg, retentionNote);
  store.on(
    ['retentionId'],
    (s) => {
      for (const b of seg.querySelectorAll('button')) {
        const on = b.dataset.id === s.retentionId;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      const p = presetById(s.retentionId);
      retentionNote.replaceChildren(p.description + ' ');
      if (p.url)
        retentionNote.append(
          el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Source'),
        );
    },
    true,
  );

  // Cameras
  const cams = section('Cameras');
  const modeSeg = el('div', {
    class: 'segmented',
    role: 'radiogroup',
    'aria-label': 'Camera mode',
  });
  const modes: [CameraMode, string, string][] = [
    ['real', 'Real', 'ALPRs mapped in OpenStreetMap'],
    ['simulated', 'Simulated', 'A hypothetical camera at major junctions'],
    ['both', 'Both', 'Real and hypothetical together'],
  ];
  for (const [id, label, title] of modes) {
    const b = el(
      'button',
      { type: 'button', role: 'radio', 'data-id': id, title },
      el('span', { class: 'seg-main' }, label),
    );
    b.addEventListener('click', () => store.set({ cameraMode: id }));
    modeSeg.append(b);
  }
  modeSeg.addEventListener('keydown', (e) => radioKeys(e, modeSeg));
  const camStatus = el('div', { class: 'cam-status', role: 'status' });
  const simBox = el('div', { class: 'sim-box' });
  cams.append(modeSeg, camStatus, simBox);

  const coverage = range(
    'Coverage',
    0,
    100,
    5,
    (v) => `${v}% of junctions`,
    (v) => store.set({ simCoverage: v }),
  );
  const spacing = range(
    'Minimum spacing',
    0,
    1000,
    50,
    (v) => (v ? `${v} m apart` : 'off'),
    (v) => store.set({ simMinSpacingM: v }),
  );
  const classes = el('fieldset', { class: 'classes' }, el('legend', {}, 'Major roads'));
  for (const c of ALL_ROAD_CLASSES) {
    const cb = el('input', { type: 'checkbox', value: c });
    cb.addEventListener('change', () => {
      const cur = new Set(store.get().simRoadClasses);
      if (cb.checked) cur.add(c);
      else cur.delete(c);
      store.set({ simRoadClasses: ALL_ROAD_CLASSES.filter((x) => cur.has(x)) as RoadClass[] });
    });
    classes.append(el('label', { class: 'check' }, cb, c));
  }
  simBox.append(
    el(
      'p',
      { class: 'hint' },
      'Hypothetical: a camera wherever two different major roads meet. Same settings → same cameras.',
    ),
    coverage.wrap,
    spacing.wrap,
    classes,
  );

  store.on(
    ['cameraMode', 'cameraStatus', 'simCoverage', 'simMinSpacingM', 'simRoadClasses', 'dataset'],
    (s) => {
      for (const b of modeSeg.querySelectorAll('button')) {
        const on = b.dataset.id === s.cameraMode;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      simBox.hidden = s.cameraMode === 'real';
      coverage.set(s.simCoverage);
      spacing.set(s.simMinSpacingM);
      for (const cb of classes.querySelectorAll('input'))
        cb.checked = s.simRoadClasses.includes(cb.value as RoadClass);
      renderCamStatus(camStatus, s);
    },
    true,
  );

  // Detection
  const det = section('Detection');
  const radius = range(
    'Read radius',
    DETECTION_DEFAULTS.radiusMinM,
    DETECTION_DEFAULTS.radiusMaxM,
    5,
    (v) => `${v} m`,
    (v) => store.set({ radiusM: v }),
  );
  const vehicle = toggle(
    'Vehicles only',
    'ALPRs read number plates, so only movement at vehicle speed (15 to 200 km/h) produces reads. Walking and running past a camera produce none.',
    (v) => store.set({ vehicleOnly: v }),
  );
  const direction = toggle(
    'Respect camera direction',
    'Where OpenStreetMap records which way a camera faces, only count passes along that direction (or its reverse, ±45°).',
    (v) => store.set({ directionFilter: v }),
  );
  det.append(radius.wrap, vehicle.wrap, direction.wrap);
  store.on(
    ['radiusM', 'vehicleOnly', 'directionFilter'],
    (s) => {
      radius.set(s.radiusM);
      vehicle.set(s.vehicleOnly);
      direction.set(s.directionFilter);
    },
    true,
  );

  // View
  const view = section('View');
  const showTrack = toggle(
    'Show my real path',
    'Dimmed line of everywhere the GPS went, for comparison. The observer never sees it.',
    (v) => store.set({ showTrack: v }),
  );
  const tzSelect = el('select', { 'aria-label': 'Time zone' });
  const tzWrap = el('label', { class: 'field' }, el('span', {}, 'Time zone'), tzSelect);
  tzSelect.addEventListener('change', () =>
    store.set({ tzOverride: tzSelect.value === 'auto' ? null : tzSelect.value }),
  );
  view.append(showTrack.wrap, tzWrap);
  store.on(
    ['showTrack', 'tzOverride', 'dataset'],
    (s) => {
      showTrack.set(s.showTrack);
      fillTimeZones(tzSelect, s);
    },
    true,
  );

  // Data
  const data = section('Your data');
  const info = el('div', { class: 'data-info' });
  const loadBtn = el('button', { type: 'button', class: 'btn' }, 'Load other GPX files');
  loadBtn.addEventListener('click', openFilePicker);
  data.append(info, loadBtn);
  store.on(
    ['dataset', 'notice', 'tzOverride'],
    (s) => {
      info.replaceChildren();
      if (!s.dataset) return;
      const tz = effectiveTimeZone(s);
      info.append(
        el('p', {}, el('strong', {}, s.dataset.name)),
        s.dataset.persona
          ? el(
              'p',
              { class: 'hint' },
              `Persona: ${s.dataset.persona}. Not a real person: every point is generated.`,
            )
          : '',
        el(
          'p',
          { class: 'hint' },
          `${s.dataset.stats.kept.toLocaleString()} points, ${formatDateTime(s.dataset.start, tz)} → ${formatDateTime(s.dataset.end, tz)}.`,
        ),
        s.notice ? el('p', { class: 'hint warn' }, s.notice) : '',
        s.dataset.kind === 'user'
          ? el(
              'p',
              { class: 'hint' },
              'Strava and similar apps only record workouts, not the whole day. For a realistic result use a continuous logger (e.g. GPSLogger on Android, OsmAnd trip recording).',
            )
          : '',
      );
    },
    true,
  );

  body.append(retention, cams, det, view, data);
}

function section(title: string, hint?: string): HTMLElement {
  const s = el('section', { class: 'ctl' }, el('h3', {}, title));
  if (hint) s.append(el('p', { class: 'hint' }, hint));
  return s;
}

function range(
  label: string,
  min: number,
  max: number,
  step: number,
  fmt: (v: number) => string,
  onInput: (v: number) => void,
) {
  const input = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    'aria-label': label,
  });
  const out = el('output', {});
  const wrap = el('label', { class: 'field range' }, el('span', {}, label), input, out);
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    onInput(Number(input.value));
  });
  return {
    wrap,
    set(v: number) {
      input.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

function toggle(label: string, help: string, onChange: (v: boolean) => void) {
  const input = el('input', { type: 'checkbox', role: 'switch' });
  const id = `h-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = el(
    'div',
    { class: 'toggle' },
    el('label', {}, input, el('span', {}, label)),
    el('p', { class: 'hint', id }, help),
  );
  input.setAttribute('aria-describedby', id);
  input.addEventListener('change', () => onChange(input.checked));
  return { wrap, set: (v: boolean) => (input.checked = v) };
}

function radioKeys(e: KeyboardEvent, group: HTMLElement) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...group.querySelectorAll('button')];
  const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
  const next =
    buttons[
      (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
        buttons.length
    ]!;
  next.click();
  next.focus();
}

function renderCamStatus(box: HTMLElement, s: AppState) {
  const st = s.cameraStatus;
  box.className = `cam-status ${st.state}`;
  box.replaceChildren();
  if (!s.dataset) return;
  if (st.state === 'loading') {
    box.append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), st.message);
    return;
  }
  if (st.state === 'error') {
    const retry = el('button', { type: 'button', class: 'btn small' }, 'Try again');
    retry.addEventListener('click', () => void refreshCameras(true));
    box.append(el('p', {}, st.message), retry);
    return;
  }
  if (st.state !== 'ready') return;
  const parts: string[] = [];
  if (s.cameraMode !== 'simulated') parts.push(`${st.realCount.toLocaleString()} mapped ALPRs`);
  if (s.cameraMode !== 'real') parts.push(`${st.simulatedCount.toLocaleString()} hypothetical`);
  box.append(el('p', {}, `${parts.join(' + ')} in this area.`));
  if (st.message) {
    const p = el('p', { class: 'warn' }, st.message);
    if (s.cameraMode === 'real') {
      const b = el('button', { type: 'button', class: 'btn small' }, 'Try simulated mode');
      b.addEventListener('click', () => store.set({ cameraMode: 'simulated' }));
      p.append(' ', b);
    }
    box.append(p);
  }
  if (st.source === 'snapshot') {
    const d = st.fetchedAt ? new Date(st.fetchedAt) : null;
    const when =
      d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
    const b = el('button', { type: 'button', class: 'linkish' }, 'refresh from OpenStreetMap');
    b.addEventListener('click', () => void refreshCameras(true));
    box.append(
      el(
        'p',
        { class: 'hint' },
        `Saved copy of OpenStreetMap data${when ? ` from ${when}` : ''} · `,
        b,
      ),
    );
  } else if (st.source === 'live') {
    box.append(
      el(
        'p',
        { class: 'hint' },
        'Live from OpenStreetMap via Overpass (asked for ~10 km grid cells, not your exact route).',
      ),
    );
  }
}

let tzKey = '';
function fillTimeZones(sel: HTMLSelectElement, s: AppState) {
  const browser = browserTimeZone();
  const auto = s.dataset?.timeZone ?? browser;
  const key = `${auto}|${s.tzOverride}`;
  if (key === tzKey) return;
  tzKey = key;
  const zones = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf?.('timeZone') ?? [browser, 'UTC'];
  sel.replaceChildren(
    el('option', { value: 'auto' }, `Automatic (${auto})`),
    ...zones.map((z) => el('option', { value: z }, z)),
  );
  sel.value = s.tzOverride ?? 'auto';
}
