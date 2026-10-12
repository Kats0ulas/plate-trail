/**
 * Local-time helpers. Timestamps are UTC epoch ms everywhere; home/work logic needs the
 * person's local wall-clock time, which depends on an IANA time zone (and DST).
 * Offsets are computed with Intl.DateTimeFormat once per UTC hour and cached.
 */

const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Browser's own zone, e.g. "Europe/Athens". */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Offset of local time from UTC at instant t, in ms (e.g. +3 h for Athens in summer). */
export function tzOffsetMs(t: number, timeZone: string): number {
  // DST changes happen on whole hours in every zone we care about; quarter-hour zones
  // still have a fixed offset within an hour bucket.
  const bucket = Math.floor(t / HOUR);
  const key = timeZone + '|' + bucket;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const at = bucket * HOUR;
  const parts = formatter(timeZone).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = asUtc - at;
  if (offsetCache.size > 200_000) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

export type LocalTime = {
  /** "YYYY-MM-DD" in local time */
  dayKey: string;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  /** Minutes after local midnight, fractional. */
  minutes: number;
  hour: number;
  minute: number;
};

export function localTime(t: number, timeZone: string): LocalTime {
  const d = new Date(t + tzOffsetMs(t, timeZone));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    dayKey: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: (d.getUTCDay() + 6) % 7,
    minutes: hour * 60 + minute + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000,
    hour,
    minute,
  };
}

/** UTC instant of a local wall-clock time (e.g. 2026-09-01 08:05 in America/New_York). */
export function zonedTimeToUtc(
  y: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timeZone: string,
): number {
  const wall = Date.UTC(y, month - 1, day) + minutesOfDay * MINUTE;
  // Two passes settle the offset, including around DST changes.
  let t = wall - tzOffsetMs(wall, timeZone);
  t = wall - tzOffsetMs(t, timeZone);
  return t;
}

/** UTC instant of local midnight starting the local day that contains t. */
export function localMidnight(t: number, timeZone: string): number {
  const lt = localTime(t, timeZone);
  const [y, m, d] = lt.dayKey.split('-').map(Number) as [number, number, number];
  return zonedTimeToUtc(y, m, d, 0, timeZone);
}

/** "08:05" from minutes after midnight. */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Wed 16 Sep" in local time. */
export function formatDay(t: number, timeZone: string): string {
  const lt = localTime(t, timeZone);
  const [, m, d] = lt.dayKey.split('-').map(Number) as [number, number, number];
  return `${WEEKDAY_SHORT[lt.weekday]} ${d} ${MONTH_SHORT[m - 1]}`;
}

/** "Wed 16 Sep, 18:41" in local time. */
export function formatDateTime(t: number, timeZone: string): string {
  return `${formatDay(t, timeZone)}, ${formatClock(localTime(t, timeZone).minutes)}`;
}

/** "2 h 05 min", "35 min", "3 days 4 h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / MINUTE);
  if (totalMin < 60) return `${totalMin} min`;
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} h` : ''}`;
  return `${hours} h${mins ? ` ${String(mins).padStart(2, '0')} min` : ''}`;
}
