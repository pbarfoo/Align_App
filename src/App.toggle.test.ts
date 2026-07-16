import { describe, expect, it, vi } from 'vitest';
import {
  __test_toggleHabitCompletion as toggleHabit,
  __test_habitFromRow as habitFromRow,
} from './App';
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

describe('habitFromRow recomputes the streak on load', () => {
  it('drops a stale stored streak for a habit that has gone cold', () => {
    // Mirrors the real "Work on Business" bug: weekdays habit last done Jul 4,
    // stored streak frozen at 4, viewed Jul 16 — the streak lapsed 12 days ago.
    vi.setSystemTime(new Date('2026-07-16T12:00:00').getTime());
    const habit = habitFromRow({
      id: 'h', goal_id: 'g', title: 'Work on Business', kind: 'habit',
      recurrence: 'weekdays', streak: 4,
      completions: ['2026-06-26', '2026-06-28', '2026-07-02', '2026-07-04'],
    });
    expect(habit.streak).toBe(0); // NOT the stale 4 the coach used to quote
  });

  it('keeps an accurate streak for a habit still being kept up', () => {
    vi.setSystemTime(new Date('2026-07-16T12:00:00').getTime());
    const habit = habitFromRow({
      id: 'h', goal_id: 'g', title: 'Walking Daily', kind: 'habit',
      recurrence: 'daily', streak: 0, // stored value is ignored; recomputed
      completions: ['2026-07-13', '2026-07-14', '2026-07-15'],
    });
    expect(habit.streak).toBe(3);
  });
});
