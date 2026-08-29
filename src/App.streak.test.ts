import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test_computeStreakFromCompletions as computeStreak } from './App';
import type { Habit } from './data';

// Anchor "today" so completion date math is deterministic.
const TODAY = new Date('2026-07-20T12:00:00');

function daily(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h', goalId: 'g', title: 'Walking Daily', kind: 'habit',
    doneToday: false, recurrence: 'daily', completions: [], streak: 0, ...overrides,
  };
}

/** ISO date string for `n` days before the anchored today. */
function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('computeStreakFromCompletions', () => {
  afterEach(() => vi.useRealTimers());

  it('counts a genuine unbroken run', () => {
    vi.setSystemTime(TODAY);
    const completions = Array.from({ length: 15 }, (_, i) => daysAgo(i));
    expect(computeStreak(completions, daily())).toBe(15);
  });

  it('does not let the grace window compound: every-4th-day is not "in a row"', () => {
    // Regression: the coach reported "15 days in a row" for a habit done once
    // every four days because grace re-granted itself each step (gaps up to
    // 2*interval+grace counted). Now capped at interval+grace, so it breaks.
    vi.setSystemTime(TODAY);
    const completions = Array.from({ length: 15 }, (_, i) => daysAgo(i * 4));
    expect(computeStreak(completions, daily())).toBe(1);
  });

  it('still forgives a missed day within the 2-day grace', () => {
    vi.setSystemTime(TODAY);
    const completions = Array.from({ length: 15 }, (_, i) => daysAgo(i * 2));
    expect(computeStreak(completions, daily())).toBe(15);
  });

  it('reads a lapsed streak as broken (nothing recent counts today)', () => {
    // The stale-value root cause: once recomputed live, an old run that ended
    // well beyond the grace window no longer reports as a current streak.
    vi.setSystemTime(TODAY);
    const completions = [daysAgo(10), daysAgo(11), daysAgo(12)];
    expect(computeStreak(completions, daily())).toBe(0);
  });

  // "Bike to work", custom every 1 week: logged 08-31 and 09-07, viewed 09-15.
  // The first gap is measured against today, not a completion — the current
  // period is simply still open, and the chain itself is exactly on interval.
  it('keeps a period cadence streak while its current period is still open', () => {
    vi.setSystemTime(new Date('2026-09-15T12:00:00'));
    const weekly = daily({
      recurrence: 'custom', customInterval: 1, customUnit: 'weeks',
    });
    expect(computeStreak(['2026-08-31', '2026-09-07'], weekly)).toBe(2);
  });

  it('still breaks a period cadence streak once a whole period is skipped', () => {
    vi.setSystemTime(new Date('2026-09-25T12:00:00'));
    const weekly = daily({
      recurrence: 'custom', customInterval: 1, customUnit: 'weeks',
    });
    expect(computeStreak(['2026-08-31', '2026-09-07'], weekly)).toBe(0);
  });
});
