import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDuration,
  isValidTimeZone,
  localMidnight,
  localTime,
  zonedTimeToUtc,
} from '../src/engine/time';

describe('time zones', () => {
  it('converts UTC to local wall-clock time', () => {
    const t = Date.UTC(2026, 8, 1, 12, 5); // 12:05 UTC
    expect(localTime(t, 'America/New_York').minutes).toBe(8 * 60 + 5); // EDT, UTC−4
    expect(localTime(t, 'Europe/Athens').minutes).toBe(15 * 60 + 5); // EEST, UTC+3
    expect(localTime(t, 'Europe/Athens').weekday).toBe(1); // Tuesday
  });

  it('round-trips local times, including after a DST change', () => {
    const t = zonedTimeToUtc(2026, 11, 2, 8 * 60, 'America/New_York'); // after DST ended
    expect(new Date(t).toISOString()).toBe('2026-11-02T13:00:00.000Z');
    const m = localMidnight(Date.UTC(2026, 8, 1, 3), 'America/New_York');
    expect(new Date(m).toISOString()).toBe('2026-08-31T04:00:00.000Z');
  });

  it('validates zone names', () => {
    expect(isValidTimeZone('Europe/Athens')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('formats clocks and durations', () => {
    expect(formatClock(8 * 60 + 5.4)).toBe('08:05');
    expect(formatDuration(125 * 60_000)).toBe('2 h 05 min');
    expect(formatDuration(35 * 60_000)).toBe('35 min');
    expect(formatDuration(28 * 3_600_000)).toBe('1 day 4 h');
  });
});
