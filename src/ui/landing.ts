import { fetchManifest, loadDemo, type DemoEntry } from '../app';
import { RETENTION_AS_OF, RETENTION_PRESETS } from '../config/retention';
import { store } from '../state';
import { el } from './format';

/** First screen: two sentences, two buttons, and the privacy promise. */
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
    el('h1', { id: 'landing-title' }, 'Retention Window'),
    el(
      'p',
      { class: 'lead' },
      'Licence-plate cameras (ALPRs) record every car that drives past. Replay a few weeks of driving through such a network and see what an observer could work out about a life — and how much the data-retention period changes that.',
    ),
    el('div', { class: 'landing-actions' }, demoBtn, fileBtn),
    sampleNote,
    alt,
    badge,
    status,
    el(
      'p',
      { class: 'fineprint' },
      `Retention presets (as of ${RETENTION_AS_OF}): ${RETENTION_PRESETS.map((p) => `${p.short} · ${p.source}`).join(' — ')}.`,
    ),
  );
  root.append(card);

  demoBtn.addEventListener('click', () => void loadDemo('atlanta'));
  fileBtn.addEventListener('click', openFilePicker);
  badge.addEventListener('click', openAbout);

  fetchManifest()
    .then((demos: DemoEntry[]) => {
      const atl = demos.find((d) => d.slug === 'atlanta');
      if (atl)
        sampleNote.textContent = `The sample: five weeks in the life of ${atl.persona.replace(/^[^,]+, /, 'a synthetic persona — ')}, with the ALPRs really mapped there.`;
      const others = demos.filter((d) => d.slug !== 'atlanta');
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
