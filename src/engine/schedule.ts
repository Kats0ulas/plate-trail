import type { Confidence, Schedule, ScheduleRow, TimeStat } from '../types';
import type { Kind, Visit } from './labeling';
import type { ScheduleParams } from './params';
import { WEEKDAY_LONG, formatClock, localTime } from './time';

/**
 * Daily routine per weekday: when the person leaves home, gets to work, leaves work and
 * gets back home, as mean ± standard deviation. For the observer these are the moments the
 * first/last camera read happened, which is all a camera network can know.
 */

type DayTimes = {
  weekday: number;
  leaveHome?: number;
  arriveWork?: number;
  leaveWork?: number;
  returnHome?: number;
};
type Key = 'leaveHome' | 'arriveWork' | 'leaveWork' | 'returnHome';
const KEYS: Key[] = ['leaveHome', 'arriveWork', 'leaveWork', 'returnHome'];

export function timeStat(values: readonly number[]): TimeStat | undefined {
  if (!values.length) return undefined;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { meanMin: round1(mean), stdMin: round1(sd), n: values.length };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function buildSchedule(
  homeVisits: readonly Visit[],
  workVisits: readonly Visit[],
  timeZone: string,
  params: ScheduleParams,
  kind: Kind,
): Schedule {
  const days = new Map<string, DayTimes>();
  const at = (t: number) => {
    const lt = localTime(t, timeZone);
    let d = days.get(lt.dayKey);
    if (!d) days.set(lt.dayKey, (d = { weekday: lt.weekday }));
    return { d, min: lt.minutes };
  };
  for (const v of homeVisits) {
    const { d, min } = at(v.depart);
    if (
      min >= params.morningStartMin &&
      min <= params.morningEndMin &&
      (d.leaveHome === undefined || min < d.leaveHome)
    )
      d.leaveHome = min;
  }
  for (const v of workVisits) {
    const a = at(v.arrive);
    if (a.d.arriveWork === undefined || a.min < a.d.arriveWork) a.d.arriveWork = a.min;
    const l = at(v.depart);
    if (l.d.leaveWork === undefined || l.min > l.d.leaveWork) l.d.leaveWork = l.min;
  }
  for (const v of homeVisits) {
    const { d, min } = at(v.arrive);
    if (
      d.leaveWork !== undefined &&
      min > d.leaveWork &&
      (d.returnHome === undefined || min < d.returnHome)
    )
      d.returnHome = min;
  }

  const rows: ScheduleRow[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const ds = [...days.values()].filter(
      (d) => d.weekday === wd && KEYS.some((k) => d[k] !== undefined),
    );
    const row: ScheduleRow = { weekday: wd, days: ds.length };
    for (const k of KEYS) {
      const s = timeStat(ds.map((d) => d[k]).filter((x): x is number => x !== undefined));
      if (s) row[k] = s;
    }
    rows.push(row);
  }

  // Predictability: how many weekdays show a routine × how tight the times are, pooled over
  // Monday to Friday (one week of data already shows whether 08:05 is the norm).
  const weekdayDays = [...days.values()].filter((d) => d.weekday <= 4);
  const pooledStats = KEYS.map((k) =>
    timeStat(weekdayDays.map((d) => d[k]).filter((x): x is number => x !== undefined)),
  ).filter((st): st is TimeStat => !!st && st.n >= 2);
  const covered = new Set(
    weekdayDays.filter((d) => KEYS.some((k) => d[k] !== undefined)).map((d) => d.weekday),
  ).size;
  const avgStd = pooledStats.length
    ? pooledStats.reduce((sum, x) => sum + x.stdMin, 0) / pooledStats.length
    : Infinity;
  const predictability = pooledStats.length
    ? Math.round(100 * (covered / 5) * Math.exp(-avgStd / params.spreadScaleMin))
    : 0;
  const nDays = weekdayDays.filter((d) => KEYS.some((k) => d[k] !== undefined)).length;
  const confidence: Confidence =
    nDays >= 8 && predictability >= 60
      ? 'High'
      : nDays >= 3 && predictability >= 25
        ? 'Medium'
        : 'Low';

  // Plain-language summary across weekdays.
  const evidence: string[] = [];
  const pooled = (k: Key) =>
    timeStat(weekdayDays.map((d) => d[k]).filter((x): x is number => x !== undefined));
  const phrases: Record<Key, string> =
    kind === 'observer'
      ? {
          leaveHome: 'First read after leaving home',
          arriveWork: 'Last read before work',
          leaveWork: 'First read after work',
          returnHome: 'Last read before getting home',
        }
      : {
          leaveHome: 'Leaves home',
          arriveWork: 'Arrives at work',
          leaveWork: 'Leaves work',
          returnHome: 'Gets home',
        };
  for (const k of KEYS) {
    const s = pooled(k);
    if (s && s.n >= 2)
      evidence.push(
        `${phrases[k]}: around ${formatClock(s.meanMin)} (± ${Math.round(s.stdMin)} min) on weekdays, seen on ${s.n} days.`,
      );
  }
  const best = rows
    .filter((r) => r.leaveHome && r.leaveHome.n >= 2)
    .sort((a, b) => a.leaveHome!.stdMin - b.leaveHome!.stdMin)[0];
  if (best?.leaveHome)
    evidence.push(
      `Most predictable morning: ${WEEKDAY_LONG[best.weekday]} (${formatClock(best.leaveHome.meanMin)} ± ${Math.round(best.leaveHome.stdMin)} min).`,
    );

  return { rows, predictability, confidence, evidence };
}
