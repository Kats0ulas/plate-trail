import { presetById } from '../config/retention';
import { DAY, formatDateTime, localMidnight, localTime } from '../engine/time';
import { windowStart } from '../engine/retention';
import { SPEEDS, effectiveTimeZone, store, type AppState } from '../state';
import { el } from './format';

/**
 * Timeline: day ticks, a tick per camera read, the cursor T, and the shaded retention
 * band [T − r, T] that slides with it. Scrub with the pointer; arrows move by an hour
 * (Shift: a day), Home/End jump, Space plays/pauses.
 */

const HOUR = 3_600_000;

export function mountTimeline(root: HTMLElement): void {
  const play = el('button', { class: 'tl-play', type: 'button', 'aria-label': 'Play' });
  const speed = el(
    'select',
    { class: 'tl-speed', 'aria-label': 'Replay speed' },
    ...SPEEDS.map((s) => el('option', { value: String(s.value) }, s.label)),
  );
  const clock = el('div', { class: 'tl-clock', 'aria-live': 'off' });
  const canvas = el('canvas', { class: 'tl-canvas', 'aria-hidden': 'true' });
  const slider = el('div', {
    class: 'tl-slider',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Observer’s “now” (timeline cursor)',
    'aria-valuemin': '0',
    'aria-valuemax': '0',
    'aria-valuenow': '0',
  });
  const legend = el(
    'div',
    { class: 'tl-legend' },
    el('span', { class: 'lg band' }, 'retention window'),
    el('span', { class: 'lg read' }, 'camera read'),
  );
  slider.append(canvas);
  root.append(el('div', { class: 'tl-controls' }, play, speed, clock, legend), slider);

  play.addEventListener('click', () => togglePlay());
  speed.addEventListener('change', () => store.set({ speed: Number(speed.value) }));

  // --- playback loop
  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    const s = store.get();
    if (!s.playing || !s.dataset) return;
    const dt = Math.min(100, now - last);
    last = now;
    const T = Math.min(s.dataset.end, s.T + (s.speed * dt) / 1000);
    store.set({ T, playing: T < s.dataset.end });
    raf = requestAnimationFrame(loop);
  };
  store.on(
    ['playing'],
    (s) => {
      play.classList.toggle('playing', s.playing);
      play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      play.innerHTML = s.playing
        ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>';
      cancelAnimationFrame(raf);
      if (s.playing) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    },
    true,
  );
  store.on(['speed'], (s) => (speed.value = String(s.speed)), true);

  function togglePlay() {
    const s = store.get();
    if (!s.dataset) return;
    if (!s.playing && s.T >= s.dataset.end) store.set({ T: s.dataset.start });
    store.set({ playing: !store.get().playing });
  }

  // --- scrubbing
  const timeAt = (clientX: number) => {
    const s = store.get();
    if (!s.dataset) return 0;
    const r = canvas.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (clientX - r.left - PAD) / (r.width - 2 * PAD)));
    return s.dataset.start + u * (s.dataset.end - s.dataset.start);
  };
  slider.addEventListener('pointerdown', (e) => {
    slider.setPointerCapture(e.pointerId);
    slider.focus();
    store.set({ playing: false, T: timeAt(e.clientX) });
    const move = (ev: PointerEvent) => store.set({ T: timeAt(ev.clientX) });
    const up = () => {
      slider.removeEventListener('pointermove', move);
      slider.removeEventListener('pointerup', up);
      slider.removeEventListener('pointercancel', up);
    };
    slider.addEventListener('pointermove', move);
    slider.addEventListener('pointerup', up);
    slider.addEventListener('pointercancel', up);
  });
  slider.addEventListener('keydown', (e) => {
    const s = store.get();
    if (!s.dataset) return;
    const step = e.shiftKey ? DAY : HOUR;
    let T = s.T;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') T += step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') T -= step;
    else if (e.key === 'PageUp') T += DAY;
    else if (e.key === 'PageDown') T -= DAY;
    else if (e.key === 'Home') T = s.dataset.start;
    else if (e.key === 'End') T = s.dataset.end;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      togglePlay();
      return;
    } else return;
    e.preventDefault();
    store.set({ playing: false, T: Math.max(s.dataset.start, Math.min(s.dataset.end, T)) });
  });

  // --- drawing
  const redraw = () => draw(canvas, store.get());
  new ResizeObserver(redraw).observe(canvas);
  store.on(['T', 'detections', 'retentionId', 'dataset', 'tzOverride'], (s) => {
    redraw();
    const tz = effectiveTimeZone(s);
    clock.textContent = s.dataset ? formatDateTime(s.T, tz) : '';
    if (s.dataset) {
      slider.setAttribute('aria-valuemin', String(Math.round(s.dataset.start / 60_000)));
      slider.setAttribute('aria-valuemax', String(Math.round(s.dataset.end / 60_000)));
      slider.setAttribute('aria-valuenow', String(Math.round(s.T / 60_000)));
      slider.setAttribute(
        'aria-valuetext',
        `${formatDateTime(s.T, tz)}, retention ${presetById(s.retentionId).short}`,
      );
    }
  });
}

const PAD = 10;

function draw(canvas: HTMLCanvasElement, s: AppState): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const d = s.dataset;
  if (!d) return;
  const span = Math.max(1, d.end - d.start);
  const x = (t: number) => PAD + ((t - d.start) / span) * (w - 2 * PAD);
  const tz = effectiveTimeZone(s);
  const css = getComputedStyle(canvas);
  const ink = css.getPropertyValue('--ink').trim() || '#1f2937';
  const muted = css.getPropertyValue('--muted').trim() || '#6b7280';

  // Days: weekend shading + midnight ticks + labels
  const days = span / DAY;
  // Label every Nth day so labels never collide (≥ 38 px apart).
  const pxPerDay = (w - 2 * PAD) / Math.max(days, 1);
  const labelEvery = [1, 2, 3, 7, 14, 28, 56].find((n) => n * pxPerDay >= 38) ?? 91;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  let dayIndex = 0;
  for (
    let m = localMidnight(d.start, tz);
    m < d.end;
    m = localMidnight(m + DAY + 2 * HOUR, tz), dayIndex++
  ) {
    const lt = localTime(m + 60_000, tz);
    const next = localMidnight(m + DAY + 2 * HOUR, tz);
    if (lt.weekday >= 5) {
      ctx.fillStyle = 'rgba(100,116,139,0.10)';
      ctx.fillRect(
        x(Math.max(m, d.start)),
        0,
        x(Math.min(next, d.end)) - x(Math.max(m, d.start)),
        h,
      );
    }
    if (m >= d.start) {
      ctx.fillStyle = lt.weekday === 0 ? ink : muted;
      ctx.globalAlpha = lt.weekday === 0 ? 0.6 : 0.25;
      ctx.fillRect(Math.round(x(m)), lt.weekday === 0 ? 0 : h - 8, 1, lt.weekday === 0 ? h : 8);
      ctx.globalAlpha = 1;
    }
    if (dayIndex % labelEvery === 0 && x(m) > PAD - 1) {
      ctx.fillStyle = muted;
      const [, mo, da] = lt.dayKey.split('-');
      ctx.fillText(`${Number(da)}/${Number(mo)}`, x(Math.max(m, d.start)) + 2, 2);
    }
  }

  // Retention band [T − r, T]
  const hours = presetById(s.retentionId).hours;
  const from = Math.max(d.start, windowStart(s.T, hours));
  ctx.fillStyle = 'rgba(213, 94, 0, 0.16)';
  ctx.fillRect(x(from), 14, Math.max(1, x(s.T) - x(from)), h - 14);
  ctx.fillStyle = 'rgba(213, 94, 0, 0.75)';
  ctx.fillRect(x(from), 14, 1.5, h - 14);

  // Camera reads
  ctx.fillStyle = '#9a3412';
  const seen = new Set<number>();
  for (const det of s.detections) {
    const px = Math.round(x(det.t));
    if (seen.has(px)) continue;
    seen.add(px);
    const inWindow = det.t >= from && det.t <= s.T;
    ctx.globalAlpha = inWindow ? 0.95 : 0.3;
    ctx.fillRect(px, 20, 1, h - 30);
  }
  ctx.globalAlpha = 1;

  // Cursor
  ctx.fillStyle = ink;
  ctx.fillRect(Math.round(x(s.T)) - 1, 10, 2, h - 10);
  ctx.beginPath();
  ctx.arc(x(s.T), 12, 4.5, 0, Math.PI * 2);
  ctx.fill();
}
