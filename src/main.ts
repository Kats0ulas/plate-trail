import './ui/styles.css';
import { loadFiles, wirePipeline } from './app';
import { createMap } from './map/basemap';
import { flyToPlace, installLayers, reducedMotion } from './map/layers';
import { store } from './state';
import { mountAbout } from './ui/about';
import { mountControls } from './ui/controls';
import { el } from './ui/format';
import { lockIcon, mountLanding } from './ui/landing';
import { mountNotebook } from './ui/notebook';
import { mountTimeline } from './ui/timeline';

const app = document.getElementById('app')!;

const mapEl = el('div', { id: 'map', role: 'region', 'aria-label': 'Map' });
const fileInput = el('input', {
  type: 'file',
  multiple: true,
  accept: '.gpx,.tcx,.kml,application/gpx+xml',
  hidden: true,
  'aria-hidden': 'true',
});
const openFilePicker = () => fileInput.click();
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) void loadFiles([...fileInput.files]);
  fileInput.value = '';
});

const about = mountAbout();
const howBtn = el('button', { type: 'button', class: 'linkish light' }, 'How it works');
howBtn.addEventListener('click', about.open);
const badge = el(
  'button',
  { type: 'button', class: 'privacy-badge small' },
  lockIcon(),
  'Your data never leaves this browser',
);
badge.addEventListener('click', about.open);
const topbar = el(
  'header',
  { class: 'topbar' },
  el('span', { class: 'brand' }, 'Plate Trail'),
  badge,
  howBtn,
);

const controls = el('aside', { class: 'panel left', id: 'controls', 'aria-label': 'Controls' });
const notebook = el('aside', {
  class: 'panel right',
  id: 'notebook',
  'aria-label': 'Observer’s notebook',
});
const timeline = el('div', {
  class: 'timeline',
  id: 'timeline',
  role: 'group',
  'aria-label': 'Timeline',
});
const tabs = el('nav', { class: 'sheet-tabs', 'aria-label': 'Panels' });
const tabControls = el('button', { type: 'button', 'aria-controls': 'controls' }, 'Controls');
const tabNotebook = el(
  'button',
  { type: 'button', 'aria-controls': 'notebook' },
  'Observer’s notebook',
);
tabs.append(tabControls, tabNotebook);
const landing = el('div', { class: 'landing' });
const dropzone = el(
  'div',
  { class: 'dropzone', hidden: true },
  el('p', {}, 'Drop GPX files to replay them'),
);
const toast = el('div', { class: 'toast', role: 'alert', hidden: true });

app.append(mapEl, topbar, controls, notebook, timeline, tabs, landing, dropzone, toast, fileInput);

const map = createMap(mapEl);
map.on('error', (e) => console.error('[map]', e.error?.message ?? e));
// Data layers go in as soon as the style is ready (no need to wait for every tile); they
// pick up whatever is already loaded, so clicking the demo early is fine.
if (map.isStyleLoaded()) installLayers(map);
else map.once('style.load', () => installLayers(map));

// Dev server only (stripped from builds): lets the README GIF recorder drive the app.
if (import.meta.env.DEV) Object.assign(window, { __rw: { map, store } });

mountLanding(landing, openFilePicker, about.open);
mountControls(controls, openFilePicker);
mountNotebook(notebook, (p) => {
  flyToPlace(map, p);
  if (window.innerWidth < 900) store.set({ sheetOpen: false });
});
mountTimeline(timeline);
wirePipeline();

// Mobile bottom sheet: one panel at a time.
const pick = (sheet: 'controls' | 'notebook') => {
  const s = store.get();
  store.set({ sheet, sheetOpen: s.sheet === sheet ? !s.sheetOpen : true });
};
tabControls.addEventListener('click', () => pick('controls'));
tabNotebook.addEventListener('click', () => pick('notebook'));
store.on(
  ['sheet', 'sheetOpen', 'phase'],
  (s) => {
    app.dataset.phase = s.phase;
    app.dataset.sheet = s.sheet;
    app.dataset.sheetOpen = String(s.sheetOpen);
    tabControls.setAttribute('aria-expanded', String(s.sheetOpen && s.sheet === 'controls'));
    tabNotebook.setAttribute('aria-expanded', String(s.sheetOpen && s.sheet === 'notebook'));
  },
  true,
);

// Errors after the landing screen show as a toast.
let toastTimer = 0;
store.on(['error'], (s) => {
  if (!s.error || s.phase !== 'ready') return;
  toast.textContent = s.error;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    store.set({ error: null });
  }, 8000);
});

// Drag & drop anywhere.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropzone.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void loadFiles(files);
});

document.documentElement.classList.toggle('reduced-motion', reducedMotion());
