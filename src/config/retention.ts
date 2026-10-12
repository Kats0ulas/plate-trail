/**
 * Retention presets, as of October 2026. Bills change: keep this as data, not UI code,
 * and update the README table together with it.
 */
export type RetentionPreset = {
  id: string;
  /** null = no limit */
  hours: number | null;
  short: string;
  /** Where the number comes from, shown under the label. */
  source: string;
  description: string;
  url?: string;
};

const TECHCRUNCH =
  'https://techcrunch.com/2026/10/02/sanders-introduces-bill-to-ban-the-federal-government-from-using-flock/';

export const RETENTION_AS_OF = 'October 2026';

export const RETENTION_PRESETS: readonly RetentionPreset[] = [
  {
    id: '48h',
    hours: 48,
    short: '48 h',
    source: 'Ban Flock Act',
    description:
      'Ban Flock Act (Sen. Sanders, introduced 2 Oct 2026): bars federal ALPR use; the only exceptions (tolls, uses Congress approves later) must delete reads after 48 hours.',
    url: 'https://www.sanders.senate.gov/wp-content/uploads/Ban-Flock-Act.pdf',
  },
  {
    id: '7d',
    hours: 7 * 24,
    short: '7 d',
    source: 'Flock default',
    description: "Flock Safety's default retention since August 2026 (lowered from 30 days).",
    url: TECHCRUNCH,
  },
  {
    id: '10d',
    hours: 10 * 24,
    short: '10 d',
    source: 'Stop Flock Abuse Act',
    description:
      'Stop Flock Abuse Act (Sen. Hawley): written approval for searches and deletion after ten days.',
    url: 'https://www.404media.co/lawmakers-introduce-multiple-laws-to-curb-flock-after-404-media-coverage/',
  },
  {
    id: '21d',
    hours: 21 * 24,
    short: '21 d',
    source: 'Connecticut',
    description: 'Connecticut Public Act 26-14 (SB 397), in effect since 1 Oct 2026.',
    url: 'https://search.cga.state.ct.us/2026/PA/pdf/2026PA-00014-R00SB-00397-PA.pdf',
  },
  {
    id: '30d',
    hours: 30 * 24,
    short: '30 d',
    source: 'Flock, before Aug 2026',
    description: "Flock Safety's default retention before August 2026.",
    url: TECHCRUNCH,
  },
  {
    id: 'forever',
    hours: null,
    short: 'Forever',
    source: 'No limit',
    description: 'No retention limit: every read is kept.',
  },
];

export const DEFAULT_RETENTION_ID = '30d';

export function presetById(id: string): RetentionPreset {
  return RETENTION_PRESETS.find((p) => p.id === id) ?? RETENTION_PRESETS[0]!;
}
