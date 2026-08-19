import { describe, expect, it, vi } from 'vitest';
import { __test_birthCredit, __test_computeHealth, __test_subGoalHalfLife, __test_subGoalScale } from './App';
import type { Goal, Habit } from './data';

/**
 * Sub-goal scale correction. A sub-goal's work also counts toward its parent,
 * and the parent additionally earns the two biggest point values in the model
 * (+10 built / +40 completed per sub-goal) that a milestone can't earn at all —
 * while decaying on a faster clock. These tests pin the two corrections that
 * close that gap without touching top-level scores.
 */

const day = 86_400_000;
const now = new Date('2026-08-02T12:00:00Z').getTime();
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g',
    domainId: 'career',
    valueIndexes: [],
    horizon: 'short',
    title: 'Goal',
    createdAt: now,
    timeframe: 3,
    ...overrides,
  };
}

/** A habit kept every `everyN` days for the last `ageDays`. */
function kept(id: string, ageDays: number, everyN: number): Habit {
  const completions: string[] = [];
  for (let d = ageDays; d >= 0; d -= everyN) completions.push(ymd(now - d * day));
  return {
    id,
    goalId: 'g-sub',
    title: id,
    kind: 'habit',
    doneToday: false,
    recurrence: everyN === 1 ? 'daily' : 'custom',
    startDate: ymd(now - ageDays * day),
    completions,
    streak: 5,
    createdAt: now - ageDays * day,
  };
}

describe('sub-goal half-life — a milestone is graded on its parent’s clock too', () => {
  it('a top-level goal keeps its own horizon half-life', () => {
    const goals = [goal({ id: 'top', horizon: 'short' })];
    expect(__test_subGoalHalfLife(goals[0], goals)).toBe(14);
  });

  it('a short sub-goal under a long parent decays at the midpoint, not the 14-day clock', () => {
    const parent = goal({ id: 'p', horizon: 'long', timeframe: 5 });
    const sub    = goal({ id: 's', horizon: 'short', parentGoalId: 'p' });
    expect(__test_subGoalHalfLife(sub, [parent, sub])).toBe((14 + 60) / 2);
  });

  it('never decays a sub-goal FASTER than its own horizon would', () => {
    const parent = goal({ id: 'p', horizon: 'short' });
    const sub    = goal({ id: 's', horizon: 'long', timeframe: 2, parentGoalId: 'p' });
    expect(__test_subGoalHalfLife(sub, [parent, sub])).toBe(60);
  });

  it('falls back to the goal’s own horizon when the parent is missing (e.g. parked)', () => {
    const orphan = goal({ id: 's', horizon: 'short', parentGoalId: 'gone' });
    expect(__test_subGoalHalfLife(orphan, [orphan])).toBe(14);
  });
});

describe('sub-goal earned-point scale', () => {
  it('keys off HAVING a parent, not off being childless — so gaining a child never flips it', () => {
    expect(__test_subGoalScale(goal({ id: 'top' }))).toBe(1);
    expect(__test_subGoalScale(goal({ id: 's', parentGoalId: 'p' }))).toBeGreaterThan(1);
    // A mid-tree goal (has a parent AND children) is still scaled as a sub-goal.
    expect(__test_subGoalScale(goal({ id: 'mid', parentGoalId: 'p' }))).toBe(
      __test_subGoalScale(goal({ id: 's', parentGoalId: 'p' })),
    );
  });

  it('lifts EARNED points only — the scale leaves the birth credit alone', () => {
    vi.setSystemTime(now);
    const plain  = __test_computeHealth([], [], now, 0, 30, now);
    const scaled = __test_computeHealth([], [], now, 0, 30, now, undefined, undefined, 1.6);
    expect(Math.round(plain * 100)).toBe(50);
    expect(scaled).toBe(plain); // no earned ledger yet → the scale changes nothing
  });

  it('leaves TASK points outside the lift — ticking one off a sub-goal moves it no more than off a top-level goal', () => {
    vi.setSystemTime(now);
    const done: Habit = {
      id: 't', goalId: 'g-sub', title: 'Task', kind: 'task', doneToday: false,
      completed: true, completedAt: now, createdAt: now,
    };
    const empty  = __test_computeHealth([], [], now, 0, 30, now);
    const top    = __test_computeHealth([], [done], now, 0, 30, now);
    const sub    = __test_computeHealth([], [done], now, 0, 30, now, undefined, undefined, 1.6);
    expect(Math.round((top - empty) * 100)).toBe(8);  // +2 built, +6 completed
    expect(sub).toBeCloseTo(top, 10);                 // the 1.6x doesn't touch it
  });

  it('births a sub-goal at 75 and a top-level goal at 50', () => {
    vi.setSystemTime(now);
    expect(__test_birthCredit(goal({ id: 'top' }))).toBe(50);
    expect(__test_birthCredit(goal({ id: 's', parentGoalId: 'p' }))).toBe(75);
    const sub = __test_computeHealth([], [], now, 0, 30, now, undefined, undefined, 1.6, undefined, 75);
    expect(Math.round(sub * 100)).toBe(75);
  });

  it('closes the gap on identical real work: a weekly-habit sub-goal is no longer rock bottom', () => {
    vi.setSystemTime(now);
    const habits = [kept('a', 60, 7), kept('b', 60, 7)];
    const before = __test_computeHealth([], habits, now, 0, 14, now - 60 * day);
    const after  = __test_computeHealth([], habits, now, 0, 37, now - 60 * day, undefined, undefined, 1.6);
    expect(Math.round(before * 100)).toBeLessThan(34);      // was red
    expect(Math.round(after * 100)).toBeGreaterThan(66);    // now green
  });

  it('still lets a neglected sub-goal fall — the lift is a scale change, not a floor', () => {
    vi.setSystemTime(now);
    // Two habits untouched for 3 weeks plus an overdue task, on a 4-month-old goal.
    const stale = [kept('a', 60, 7), kept('b', 60, 7)].map((h) => ({
      ...h,
      completions: (h.completions ?? []).filter((d) => d < ymd(now - 21 * day)),
    }));
    const overdue: Habit = {
      id: 't', goalId: 'g-sub', title: 'Overdue', kind: 'task', doneToday: false,
      completed: false, dueDate: ymd(now - 10 * day), createdAt: now - 30 * day,
    };
    const scaled = __test_computeHealth([], [...stale, overdue], now, 0, 37, now - 120 * day, undefined, undefined, 1.6);
    // Lands at 37: still well under the 50 a goal is born at, so neglect still
    // visibly bleeds it. (Was 33 while the overdue drag was scaled too — tasks
    // now sit outside the lift on BOTH sides, credit and penalty.)
    expect(Math.round(scaled * 100)).toBeLessThanOrEqual(40);
  });

  it('scales penalties along with credits, so a skip stays exactly as costly relative to a completion', () => {
    vi.setSystemTime(now);
    // Weekly, so neither variant saturates at the 100-point ceiling.
    const clean: Habit = { ...kept('h', 30, 7), skippedDates: [] };
    const skipped: Habit = { ...clean, skippedDates: [ymd(now - day), ymd(now - 2 * day)] };
    const dropPlain  = __test_computeHealth([], [clean], now, 0, 30, undefined) -
                       __test_computeHealth([], [skipped], now, 0, 30, undefined);
    const dropScaled = __test_computeHealth([], [clean], now, 0, 30, undefined, undefined, undefined, 1.6) -
                       __test_computeHealth([], [skipped], now, 0, 30, undefined, undefined, undefined, 1.6);
    expect(dropScaled).toBeCloseTo(dropPlain * 1.6, 6);
  });

  it('an empty sub-goal never outranks a comparable top-level goal', () => {
    vi.setSystemTime(now);
    for (const age of [7, 21, 60]) {
      const sub = __test_computeHealth([], [], now, 0, 37, now - age * day, undefined, undefined, 1.6);
      const top = __test_computeHealth([], [], now, 0, 60, now - age * day);
      expect(sub).toBeLessThan(top);
    }
  });
});
