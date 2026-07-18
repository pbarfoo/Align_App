import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test_isHabitScheduledToday as isHabitScheduledToday } from './App';
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
