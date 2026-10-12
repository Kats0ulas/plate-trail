import type { PlaceLabel } from '../types';

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export const LABEL_NAMES: Record<PlaceLabel, string> = {
  home: 'Home',
  work: 'Work',
  recurring: 'Recurring place',
  rare: 'Rare visit',
};

/** Okabe–Ito colours: distinguishable with the common forms of colour blindness. */
export const LABEL_COLORS: Record<PlaceLabel, string> = {
  home: '#0072B2',
  work: '#E69F00',
  recurring: '#009E73',
  rare: '#CC79A7',
};

const ICON_PATHS: Record<PlaceLabel, string> = {
  home: 'M12 3 2 11h3v9h5v-6h4v6h5v-9h3z',
  work: 'M9 4h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V6a2 2 0 0 1 2-2zm0 3h6V6H9z',
  recurring:
    'M12 4a8 8 0 0 1 7.4 5H22l-3.5 4L15 9h2.2A6 6 0 0 0 6.3 10H4.2A8 8 0 0 1 12 4zm-7.5 7L8 15H5.8a6 6 0 0 0 10.9 1h2.1A8 8 0 0 1 4.6 15H2z',
  rare: 'M12 2 14.9 8.6 22 9.3l-5.4 4.8L18.2 21 12 17.3 5.8 21l1.6-6.9L2 9.3l7.1-.7z',
};

/** Small inline SVG icon for a place label (no inline styles, CSP-safe). */
export function labelIcon(label: PlaceLabel, size = 16): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${ICON_PATHS[label]}"/></svg>`;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Element factory: el('div', { class: 'x' }, child1, 'text'). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'style') throw new Error('no inline styles (CSP)');
    e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
