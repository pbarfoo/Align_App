import { describe, expect, it, vi } from 'vitest';
import { __test_toggleHabitCompletion as toggleHabit } from './App';
import type { Habit } from './data';

// 2026-07-07 is a Tuesday; 2026-07-08 a Wednesday.
const tue = new Date('2026-07-07T12:00:00').getTime();
const wed = new Date('2026-07-08T12:00:00').getTime();

function mwfHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h', goalId: 'g', title: 'Morning Body Exercises', kind: 'habit',
    doneToday: false, recurrence: 'specific-days', specificDays: [1, 3, 5],
    startDate: '2026-07-07', completions: [], streak: 0, ...overrides,
  };
}

describe('toggleHabitCompletion', () => {
  it('does NOT log a phantom completion on a non-scheduled day', () => {
    vi.setSystemTime(tue); // Tuesday — not Mon/Wed/Fri, and startDate is today so no backlog
    const result = toggleHabit(mwfHabit());
    expect(result.completions).toEqual([]); // nothing logged → health can't move
  });

  it('logs today when the habit IS scheduled today', () => {
    vi.setSystemTime(wed); // Wednesday — a scheduled day
    const result = toggleHabit(mwfHabit());
    expect(result.completions).toContain('2026-07-08');
  });

  it('un-logs an existing today completion (undo)', () => {
    vi.setSystemTime(wed);
    const result = toggleHabit(mwfHabit({ completions: ['2026-07-08'] }));
    expect(result.completions).not.toContain('2026-07-08');
  });

  it('undoes a weekly habit logged earlier in the week, not just "today"', () => {
    // Logged Monday 2026-07-06; viewed later the same ISO week, Thursday 2026-07-09.
    const thu = new Date('2026-07-09T12:00:00').getTime();
    vi.setSystemTime(thu);
    const weekly: Habit = {
      id: 'h', goalId: 'g', title: 'Weekly review', kind: 'habit',
      doneToday: false, recurrence: 'weekly', startDate: '2026-06-01',
      completions: ['2026-07-06'], streak: 1,
    };
    const result = toggleHabit(weekly);
    // Must UNDO (remove the Monday completion), not log a second completion for Thursday.
    expect(result.completions).toEqual([]);
  });
});
