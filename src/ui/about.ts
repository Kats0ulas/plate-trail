import { RETENTION_AS_OF, RETENTION_PRESETS } from '../config/retention';
import { OVERPASS_ENDPOINTS } from '../data/overpass';
import { BASEMAP_STYLE_URL } from '../map/basemap';
import { el } from './format';

/** "How it works": the privacy design, the method, and the limits. A native <dialog>. */
export function mountAbout(): { open: () => void } {
  const dialog = el('dialog', { class: 'about', 'aria-labelledby': 'about-title' });
  const close = el(
    'button',
    { type: 'button', class: 'btn small close', 'aria-label': 'Close' },
    'Close',
  );
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  const hosts = [
    new URL(BASEMAP_STYLE_URL).host,
    ...OVERPASS_ENDPOINTS.map((u) => new URL(u).host),
  ];

  dialog.append(
    el(
      'div',
      { class: 'about-inner' },
      el('div', { class: 'about-head' }, el('h2', { id: 'about-title' }, 'How it works'), close),
      el('h3', {}, 'Your data never leaves this browser'),
      el(
        'ul',
        {},
        el(
          'li',
          {},
          'Your GPS files are read and analysed on this device, in a background worker. There is no server, no account, no analytics, no error reporting.',
        ),
        el(
          'li',
          {},
          'Nothing about your track or the results is saved: no cookies, no localStorage, no IndexedDB. Close the tab and it is gone.',
        ),
        el(
          'li',
          {},
          `The page can only connect to itself, the map tile server and the public Overpass API (${hosts.join(', ')}). A Content-Security-Policy enforces this. Open your browser’s Network tab and check.`,
        ),
        el(
          'li',
          {},
          'Camera and road queries never contain your route. They ask for whole 0.1° grid cells (about 10 km) around it, so the tile server and Overpass only learn roughly which area (about city level) you are looking at.',
        ),
      ),
      el('h3', {}, 'What happens to your track'),
      el(
        'ol',
        {},
        el(
          'li',
          {},
          'Cameras: real ALPRs mapped in OpenStreetMap (surveillance:type=ALPR), or hypothetical ones at every major road junction.',
        ),
        el(
          'li',
          {},
          'Detection: whenever the vehicle passes within the read radius of a camera at vehicle speed, the camera logs a read: camera, time, direction. Walking produces no reads.',
        ),
        el(
          'li',
          {},
          'Retention: at any moment T, the observer can only see reads from the last N days. Older reads are deleted.',
        ),
        el(
          'li',
          {},
          'Observer: from those reads alone it splits trips (gaps over 20 min), treats the silence between trips as stays near the bracketing cameras, clusters them, and labels Home (overnight), Work (weekdays 9 to 5 on 3 or more days), recurring places and rare one-off visits, with the evidence for each.',
        ),
        el(
          'li',
          {},
          'Truth: the same rules run on your full GPS track (or the persona’s real schedule), so you can see how close the observer got.',
        ),
      ),
      el('h3', {}, `Retention presets (as of ${RETENTION_AS_OF})`),
      el(
        'ul',
        { class: 'presets' },
        ...RETENTION_PRESETS.map((p) =>
          el(
            'li',
            {},
            el('strong', {}, `${p.short}, ${p.source}. `),
            p.description + ' ',
            p.url
              ? el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Source')
              : '',
          ),
        ),
      ),
      el('h3', {}, 'Limitations'),
      el(
        'ul',
        {},
        el(
          'li',
          {},
          'OpenStreetMap camera data is crowdsourced and incomplete. Simulated cameras are hypothetical.',
        ),
        el(
          'li',
          {},
          'The inference is a handful of simple heuristics, not what any vendor or agency actually runs.',
        ),
        el(
          'li',
          {},
          'Real systems also record make, model and colour, and share data between agencies, so the real picture can be worse.',
        ),
        el('li', {}, 'Use it only on your own data. This is not legal advice.'),
      ),
      el(
        'p',
        { class: 'hint' },
        'Map data © OpenStreetMap contributors (ODbL). Basemap by OpenFreeMap. The sample personas are synthetic: generated routes along real roads, invented people.',
      ),
    ),
  );
  document.body.append(dialog);
  return { open: () => dialog.showModal() };
}
