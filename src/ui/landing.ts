import { fetchManifest, loadDemo, type DemoEntry } from '../app';
import { RETENTION_AS_OF, RETENTION_PRESETS } from '../config/retention';
import { store } from '../state';
import { el } from './format';

/** The sample behind the big button; the other samples are offered as links under it. */
const MAIN_SAMPLE = 'athens';

/** First screen: what the app does in four steps, two buttons, and the privacy promise. */
export function mountLanding(
  root: HTMLElement,
  openFilePicker: () => void,
  openAbout: () => void,
): void {
  const demoBtn = el(
    'button',
    { type: 'button', class: 'btn primary big', 'aria-describedby': 'sample-note' },
    'Try the sample week',
  );
  const fileBtn = el('button', { type: 'button', class: 'btn big' }, 'Load your own GPX');
  const badge = el(
    'button',
    { type: 'button', class: 'privacy-badge' },
    lockIcon(),
    'Your data never leaves this browser',
  );
  const alt = el('p', { class: 'alt-demo' });
  const sampleNote = el('p', { class: 'alt-demo', id: 'sample-note' });
  const status = el('p', { class: 'landing-status', role: 'status' });
  const card = el(
    'div',
    {
      class: 'landing-card',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': 'landing-title',
    },
    el('h1', { id: 'landing-title' }, 'Plate Trail'),
    el(
      'p',
      { class: 'tagline' },
      'The trail your number plate leaves behind, and how long the cameras keep it.',
    ),
    el(
      'p',
      { class: 'lead' },
      'More and more roads have cameras that read number plates (ALPRs). Every time a car drives past one, the camera saves which car it was, where, and when. Plate Trail shows what those saved records can reveal about a person.',
    ),
    el(
      'ol',
      { class: 'steps' },
      el('li', {}, el('strong', {}, 'Pick a sample week'), ' or load your own GPS file.'),
      el(
        'li',
        {},
        el('strong', {}, 'Watch the drives replay.'),
        ' Cameras light up when the car passes them.',
      ),
      el(
        'li',
        {},
        el('strong', {}, 'See what the records give away:'),
        ' home, workplace, daily routine and one-off visits, worked out from camera reads alone.',
      ),
      el(
        'li',
        {},
        el('strong', {}, 'Change how long records are kept,'),
        ' from 48 hours to forever, and see how much more a longer period reveals.',
      ),
    ),
    el(
      'p',
      { class: 'sim-note' },
      'It is a simulation: no real camera data and no number plates are used.',
    ),
    el('div', { class: 'landing-actions' }, demoBtn, fileBtn),
    sampleNote,
    alt,
    badge,
    status,
    el(
      'p',
      { class: 'fineprint' },
      `Retention periods (as of ${RETENTION_AS_OF}): ${RETENTION_PRESETS.map((p) => `${p.short} (${p.source})`).join(', ')}.`,
    ),
  );
  root.append(card);

  demoBtn.addEventListener('click', () => void loadDemo(MAIN_SAMPLE));
  fileBtn.addEventListener('click', openFilePicker);
  badge.addEventListener('click', openAbout);

  fetchManifest()
    .then((demos: DemoEntry[]) => {
      const main = demos.find((d) => d.slug === MAIN_SAMPLE);
      if (main)
        sampleNote.textContent = `The sample: five weeks of driving by a made-up person (${main.persona.replace(/^[^,]+, /, '')}), ${main.cameraMode === 'real' ? 'past the licence-plate cameras really mapped there' : 'past hypothetical cameras at the major junctions, as only a few real ones are mapped there'}.`;
      const others = demos.filter((d) => d.slug !== MAIN_SAMPLE);
      if (!others.length) return;
      alt.append('Or: ');
      others.forEach((d, i) => {
        const b = el(
          'button',
          { type: 'button', class: 'linkish' },
          `${d.city.split(',')[0]} sample (${d.cameraMode === 'simulated' ? 'simulated cameras' : 'real cameras'})`,
        );
        b.addEventListener('click', () => void loadDemo(d.slug));
        if (i) alt.append(' · ');
        alt.append(b);
      });
    })
    .catch(() => undefined);

  store.on(
    ['phase', 'loadingMessage', 'error'],
    (s) => {
      root.hidden = s.phase === 'ready';
      const busy = s.phase === 'loading';
      demoBtn.disabled = busy;
      fileBtn.disabled = busy;
      card.setAttribute('aria-busy', String(busy));
      status.className = `landing-status${s.error ? ' error' : ''}`;
      status.textContent = s.error ?? (busy ? s.loadingMessage : '');
    },
    true,
  );
}

export function lockIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3z',
  );
  svg.append(path);
  return svg;
}
