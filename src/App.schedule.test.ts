import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __test_isHabitScheduledToday as isHabitScheduledToday,
  __test_isHabitRelevantToday as isHabitRelevantToday,
  __test_skipDayPatch as skipDayPatch,
  __test_getGraceDays as getGraceDays,
} from './App';
import type { Habit } from './data';

// 2026-06-01 is a Monday; the weekly anchor weekday is derived from startDate.
// 2026-07-15 is a Wednesday; 2026-07-18 a Saturday.
const weekly = (startDate?: string): Habit => ({
  id: 'h', goalId: 'g', title: 'Bike to work', kind: 'habit',
  doneToday: false, recurrence: 'weekly', startDate,
  completions: [], streak: 0,
});

describe('isHabitScheduledToday — weekly cadence', () => {
  afterEach(() => vi.useRealTimers());

  it('shows a Wednesday-anchored weekly habit on Wednesday', () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00')); // Wednesday
    expect(isHabitScheduledToday(weekly('2026-07-08'))).toBe(true); // 2026-07-08 is a Wed
  });

  it('hides a Wednesday-anchored weekly habit on other days', () => {
    vi.setSystemTime(new Date('2026-07-18T12:00:00')); // Saturday
    expect(isHabitScheduledToday(weekly('2026-07-08'))).toBe(false);
  });

  it('falls back to showing an unanchored weekly habit (no startDate)', () => {
    vi.setSystemTime(new Date('2026-07-18T12:00:00')); // Saturday
    expect(isHabitScheduledToday(weekly(undefined))).toBe(true);
  });
});

// The live "Work on Business" row: weekly, anchored to Friday 2026-07-17, last
// logged that same Friday, with 2026-07-10 explicitly skipped. It went missing
// from Today for the six days between its missed Friday and the next one.
const workOnBusiness = (over: Partial<Habit> = {}): Habit => ({
  id: 'h-mqfwsqdf-0', goalId: 'g', title: 'Work on Business', kind: 'habit',
  doneToday: false, recurrence: 'weekly', startDate: '2026-07-17',
  completions: ['2026-06-26', '2026-06-28', '2026-07-02', '2026-07-04', '2026-07-17'],
  skippedDates: ['2026-07-10'], streak: 0, ...over,
});

describe('isHabitRelevantToday — a lapsed habit stays on Today', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps a weekly habit visible on the days after its missed Friday', () => {
    // Sunday, two days after the un-logged Friday 2026-07-24.
    vi.setSystemTime(new Date('2026-07-26T12:00:00'));
    const h = workOnBusiness();
    expect(isHabitScheduledToday(h)).toBe(false);   // not due — this was the bug
    expect(getGraceDays(h)).toEqual(['2026-07-24']); // but a missed day is owed
    expect(isHabitRelevantToday(h)).toBe(true);
  });

  it('still shows it on its own Friday', () => {
    vi.setSystemTime(new Date('2026-07-31T12:00:00'));
    expect(isHabitRelevantToday(workOnBusiness())).toBe(true);
  });

  it('goes quiet on off-days once nothing is owed', () => {
    // Friday 2026-07-24 logged: no backlog, and Sunday is not its day.
    vi.setSystemTime(new Date('2026-07-26T12:00:00'));
    const h = workOnBusiness({
      completions: [...(workOnBusiness().completions ?? []), '2026-07-24'],
    });
    expect(getGraceDays(h)).toEqual([]);
    expect(isHabitRelevantToday(h)).toBe(false);
  });

  it('goes quiet on off-days once the missed day is skipped', () => {
    vi.setSystemTime(new Date('2026-07-26T12:00:00'));
    const h = workOnBusiness({ skippedDates: ['2026-07-10', '2026-07-24'] });
    expect(getGraceDays(h)).toEqual([]);
    expect(isHabitRelevantToday(h)).toBe(false);
  });
});

// A "custom, every 1 week" habit — the cadence that regressed into a daily nag.
const customWeekly = (startDate: string, over: Partial<Habit> = {}): Habit => ({
  id: 'h', goalId: 'g', title: 'Bike to work', kind: 'habit',
  doneToday: false, recurrence: 'custom', customInterval: 1, customUnit: 'weeks',
  startDate, completions: [], streak: 0, skippedDates: [], ...over,
});

describe('skipDayPatch — period cadence advances by a whole interval', () => {
  it('advances startDate one interval (7d), not one day, for a weekly custom habit', () => {
    const patch = skipDayPatch(customWeekly('2026-07-06'), '2026-07-13');
    expect(patch.startDate).toBe('2026-07-20'); // 07-13 + 7d, not 07-14
    expect(patch.skippedDates).toContain('2026-07-13');
  });
});

describe('getGraceDays — weekly custom habit does not re-nag daily', () => {
  afterEach(() => vi.useRealTimers());

  it('goes quiet for the interval after a skip, then re-flags once it elapses', () => {
    // The elapsed weekly period surfaces a missed day.
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const flagged = getGraceDays(customWeekly('2026-07-01'));
    expect(flagged).toEqual(['2026-07-08']); // today − 7

    // Apply the skip the pill would apply.
    const patch = skipDayPatch(customWeekly('2026-07-01'), '2026-07-08');
    const skipped = customWeekly(patch.startDate!, { skippedDates: patch.skippedDates });

    // Next day: previously this re-flagged a fresh chip every day. Now silent.
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
    expect(getGraceDays(skipped)).toEqual([]);

    // A full interval later, the next elapsed period flags again.
    vi.setSystemTime(new Date('2026-07-22T12:00:00'));
    expect(getGraceDays(skipped)).toEqual(['2026-07-15']);
  });
});
