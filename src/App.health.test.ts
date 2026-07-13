import { describe, expect, it, vi } from 'vitest';
import { __test_computeHealth } from './App';
import type { Goal, Habit } from './data';

const day = 86_400_000;
const now = new Date('2026-07-06T12:00:00Z').getTime();
const HL = 30; // ongoing half-life used by most tests

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function task(overrides: Partial<Habit>): Habit {
  return {
    id: 'h-task',
    goalId: 'g-ongoing',
    title: 'Task',
    kind: 'task',
    doneToday: false,
    completed: false,
    createdAt: now,
    ...overrides,
  };
}

function habit(overrides: Partial<Habit>): Habit {
  return {
    id: 'h-habit',
    goalId: 'g-ongoing',
    title: 'Habit',
    kind: 'habit',
    doneToday: false,
    recurrence: 'daily',
    // Real habits always get a start date at creation, so missed-day detection
    // never flags days before the habit existed. Default to "started today".
    startDate: ymd(now),
    completions: [],
    streak: 0,
    createdAt: now,
    ...overrides,
  };
}

function subGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g-sub',
    domainId: 'career',
    valueIndexes: [],
    horizon: 'short',
    title: 'Subgoal',
    parentGoalId: 'g-ongoing',
    createdAt: now,
    timeframe: 1,
    ...overrides,
  };
}

const health = (subs: Goal[], habits: Habit[], hl = HL) =>
  __test_computeHealth(subs, habits, now, 0, hl);

describe('goal health — "how active am I with this goal" (event/decay model)', () => {
  it('an empty goal scores 0 — nothing built out, nothing done', () => {
    vi.setSystemTime(now);
    expect(health([], [])).toBe(0);
  });

  it('building out RAISES health, and bigger commitments raise it more (sub-goal > habit > task)', () => {
    vi.setSystemTime(now);

    const withTask  = health([], [task({ id: 't' })]);
    const withHabit = health([], [habit({ id: 'h' })]);
    const withSub   = health([subGoal({ id: 's' })], []);

    expect(withTask).toBeGreaterThan(0);          // adding raises off zero
    expect(withHabit).toBeGreaterThan(withTask);  // habit > task
    expect(withSub).toBeGreaterThan(withHabit);   // sub-goal > habit
  });

  it('adding a fresh (future/undated) item never lowers health', () => {
    vi.setSystemTime(now);

    const base = health([], [task({ id: 'done', completed: true, completedAt: now - day })]);
    const withFuture = health([], [
      task({ id: 'done', completed: true, completedAt: now - day }),
      task({ id: 'new', dueDate: '2026-09-01' }),
    ]);
    expect(withFuture).toBeGreaterThanOrEqual(base);
  });

  it('completing an item is worth MORE than merely adding it', () => {
    vi.setSystemTime(now);

    const added     = health([], [task({ id: 't' })]);
    const completed = health([], [task({ id: 't', completed: true, completedAt: now })]);
    expect(completed).toBeGreaterThan(added);
  });

  it('completing a task moves health by a modest amount — no 25-point whiplash', () => {
    vi.setSystemTime(now);

    // A built-out goal (several tasks) with one just completed vs none completed.
    const tasks = (doneIdx: number) =>
      [0, 1, 2, 3].map((i) => task({ id: `t${i}`, ...(i === doneIdx ? { completed: true, completedAt: now } : {}) }));
    const before = health([], tasks(-1));
    const after  = health([], tasks(0));

    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThan(0.2); // gentle, not a cliff
  });

  it('a skipped habit day counts as a miss — lowers health vs the same habit un-skipped', () => {
    vi.setSystemTime(now);

    const kept = habit({
      id: 'k', startDate: '2026-07-01', streak: 5,
      completions: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'],
    });
    // Same habit, but the 4th was skipped instead of done: one fewer completion
    // AND an explicit miss penalty.
    const skipped = habit({
      id: 'k', startDate: '2026-07-01', streak: 5,
      completions: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-05'],
      skippedDates: ['2026-07-04'],
    });

    expect(health([], [skipped])).toBeLessThan(health([], [kept]));
  });

  it('a task completed late earns less than the same task completed on time', () => {
    vi.setSystemTime(now);

    const onTime = health([], [task({ id: 't', completed: true, completedAt: now, dueDate: ymd(now) })]);
    const late   = health([], [task({ id: 't', completed: true, completedAt: now, dueDate: ymd(now - 5 * day) })]);
    expect(late).toBeLessThan(onTime);
  });

  it('an OPEN overdue task drags health down while it sits there', () => {
    vi.setSystemTime(now);

    const base    = health([], [task({ id: 'done', completed: true, completedAt: now })]);
    const overdue = health([], [
      task({ id: 'done', completed: true, completedAt: now }),
      task({ id: 'late', dueDate: ymd(now - 10 * day) }),
    ]);
    expect(overdue).toBeLessThan(base);
  });

  it('deleting an open overdue task raises health only modestly (the reported bug: it used to spring up)', () => {
    vi.setSystemTime(now);

    const withOverdue = health([subGoal({ id: 's1' }), subGoal({ id: 's2' })], [
      task({ id: 'done', completed: true, completedAt: now - 5 * day, dueDate: '2026-07-01' }),
      task({ id: 'late', dueDate: ymd(now - 14 * day) }),
    ]);
    const afterDelete = health([subGoal({ id: 's1' }), subGoal({ id: 's2' })], [
      task({ id: 'done', completed: true, completedAt: now - 5 * day, dueDate: '2026-07-01' }),
    ]);

    expect(afterDelete).toBeGreaterThan(withOverdue); // removing a live miss does lift it...
    expect(afterDelete - withOverdue).toBeLessThan(0.2); // ...but only a little, not a leap
  });

  it('activity decays over time — a fresh completion is worth more than an old one', () => {
    vi.setSystemTime(now);

    const fresh = health([], [task({ id: 't', completed: true, completedAt: now })]);
    const stale = health([], [task({ id: 't', completed: true, completedAt: now - 60 * day })]);
    expect(stale).toBeLessThan(fresh);
  });

  it('shorter horizons decay faster than longer ones for the same aged activity', () => {
    vi.setSystemTime(now);

    const old = [task({ id: 't', completed: true, completedAt: now - 30 * day })];
    const shortHorizon = health([], old, 14); // short goal
    const longHorizon  = health([], old, 60); // long goal
    expect(shortHorizon).toBeLessThan(longHorizon);
  });

  it('a consistently-kept daily habit reads as a strong, high score', () => {
    vi.setSystemTime(now);

    const kept = habit({
      id: 'k', recurrence: 'daily', startDate: ymd(now - 20 * day),
      completions: Array.from({ length: 21 }, (_, i) => ymd(now - i * day)),
      streak: 21,
    });
    // Habits are lightly weighted, so even a perfectly-kept one lands "solid"
    // rather than pinned near the top on its own.
    expect(health([], [kept])).toBeGreaterThan(0.6);
  });

  it('the priority-position nudge only tilts a goal slightly', () => {
    vi.setSystemTime(now);

    const items = [task({ id: 't', completed: true, completedAt: now }), habit({ id: 'h' })];
    const neutral = __test_computeHealth([], items, now, 0, HL);
    const boosted = __test_computeHealth([], items, now, 1, HL);
    expect(Math.abs(boosted - neutral)).toBeLessThan(0.1);
  });
});
