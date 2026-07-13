import { describe, expect, it, vi } from 'vitest';
import { __test_computeHealth } from './App';
import type { Goal, Habit } from './data';

const day = 86_400_000;
const now = new Date('2026-07-06T12:00:00Z').getTime();

function task(overrides: Partial<Habit>): Habit {
  return {
    id: 'h-task',
    goalId: 'g-ongoing',
    title: 'Task',
    kind: 'task',
    doneToday: false,
    completed: false,
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
    completions: [],
    streak: 0,
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
    createdAt: now - 10 * day,
    timeframe: 1,
    ...overrides,
  };
}

describe('ongoing goal health — shares the exact deadline-goal formula', () => {
  // Ongoing goals no longer have their own scoring function: computeHealth
  // has no goal-deadline/pace dependency (only individual task due dates
  // factor in, via the overdue scaling, which applies the same regardless of
  // the parent goal's horizon), so ongoingGoalMetrics calls it directly. These
  // tests re-confirm the handful of ongoing-specific behaviors that matter —
  // everything else (adding never lowers, backlog neutral, skip counts as a
  // miss, overdue scales down, earn-100, weakest-link) is already proven once
  // in the "deadline goal health" block below, against the same function.

  it('rewards a consistently-kept recurring habit as the strongest signal', () => {
    vi.setSystemTime(now);

    const health = __test_computeHealth([], [habit({
      recurrence: 'weekly', startDate: '2026-06-08',
      completions: ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'],
      streak: 5,
    })], now, 0);

    expect(health).toBeGreaterThan(0.5);
  });

  it('a lone recent touch is off the floor but far from great, and decays as it ages', () => {
    vi.setSystemTime(now);

    const touchedRecently = __test_computeHealth([subGoal({ completedAt: now - 3 * day })], [], now, 0);
    const touchedLongAgo = __test_computeHealth([subGoal({ completedAt: now - 45 * day })], [], now, 0);

    expect(touchedRecently).toBeGreaterThan(0);
    expect(touchedLongAgo).toBeLessThan(touchedRecently);
  });

  it('scales the focus adjustment by priority strength instead of an all-or-nothing flag', () => {
    vi.setSystemTime(now);

    // A genuinely weak goal (base health well below 0.5: a sub-goal touched
    // long enough ago that recency and throughput have both decayed to ~0) —
    // the negative focus adjustment should shrink toward zero as priority
    // strength drops from full (#1) to none (well below the top few positions).
    const weakGoal = [subGoal({ completedAt: now - 45 * day })];
    const noFocus = __test_computeHealth(weakGoal, [], now, 0);
    const halfFocus = __test_computeHealth(weakGoal, [], now, 0.5);
    const fullFocus = __test_computeHealth(weakGoal, [], now, 1);

    // Full priority strength penalises a weak goal hardest; no priority
    // strength leaves it unadjusted; half strength lands strictly in between.
    expect(fullFocus).toBeLessThan(halfFocus);
    expect(halfFocus).toBeLessThan(noFocus);
  });
});

describe('deadline goal health — activity-based, no done/total ratio', () => {
  const todayStr = '2026-07-06';

  it('a future task, a fresh habit, or a new sub-goal added to a goal does not drop health', () => {
    vi.setSystemTime(now);

    const doneTask = task({ id: 'done', completed: true, completedAt: now - day, dueDate: '2026-07-01' });
    const base = __test_computeHealth([], [doneTask], now, 0);

    // Not-yet-due task: backlog, not a miss.
    const futureTask = task({ id: 'fut', dueDate: '2026-08-01' });
    const withFuture = __test_computeHealth([], [doneTask, futureTask], now, 0);

    // Brand-new daily habit (starts today, no completions): neutral until it
    // has had its first interval to be done.
    const freshHabit = habit({ id: 'fresh', startDate: todayStr, completions: [] });
    const withHabit = __test_computeHealth([], [doneTask, freshHabit], now, 0);

    // Brand-new empty sub-goal (created just now): neutral to the parent.
    const newSub = subGoal({ id: 'newsub', createdAt: now });
    const withSub = __test_computeHealth([newSub], [doneTask], now, 0);

    expect(withFuture).toBeGreaterThanOrEqual(base);
    expect(withHabit).toBeGreaterThanOrEqual(base);
    expect(withSub).toBeGreaterThanOrEqual(base);
  });

  it('a big backlog of open tasks does NOT lower health (no completed/created ratio)', () => {
    vi.setSystemTime(now);

    const doneTask = task({ id: 'done', completed: true, completedAt: now - day });
    const lean = __test_computeHealth([], [doneTask], now, 0);

    // Pile on ten future/undated open tasks — a burn-down ratio would tank
    // this, but health is activity-based, so it must not drop.
    const backlog = Array.from({ length: 10 }, (_, i) => task({ id: `open-${i}` }));
    const withBacklog = __test_computeHealth([], [doneTask, ...backlog], now, 0);

    expect(withBacklog).toBeGreaterThanOrEqual(lean);
  });

  it('a goal firing on all cylinders can still earn ~100', () => {
    vi.setSystemTime(now);

    // Every axis maxed: weekly habit kept every week (consistency 1), five
    // recent task completions (throughput capped at 1), 6.5 structure weight
    // (also capped at 1 — the wider structure denominator needs a thoroughly
    // built-out goal, not just a handful of items, to actually reach it),
    // touched today (recency 1) → even the weakest-link term is 1.
    const keptHabit = habit({
      id: 'kept', recurrence: 'weekly', startDate: '2026-06-08',
      completions: ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'],
      streak: 5,
    });
    const done = [0, 1, 2, 3, 4].map((i) =>
      task({ id: `d${i}`, completed: true, completedAt: now - i * day }));

    const health = __test_computeHealth([], [keptHabit, ...done], now, 0);
    expect(health).toBeGreaterThan(0.98);
  });

  it('one weak axis keeps a goal off 100 (weakest-link term)', () => {
    vi.setSystemTime(now);

    // Same as above but the habit has been missed lately (low consistency) —
    // strong on everything else, yet the weak axis must cap it below the top.
    const missedHabit = habit({
      id: 'slip', recurrence: 'daily', startDate: '2026-05-01',
      completions: ['2026-07-06'], streak: 1,
    });
    const done = [0, 1, 2, 3].map((i) =>
      task({ id: `w${i}`, completed: true, completedAt: now - i * day }));

    const health = __test_computeHealth([], [missedHabit, ...done], now, 0);
    expect(health).toBeLessThan(0.85);
  });

  it('a sub-goal is worth more to structure than a habit, which beats a task', () => {
    vi.setSystemTime(now);
    const todayStr = '2026-07-06';

    const doneTask = task({ id: 'd', completed: true, completedAt: now - day });
    const withTask  = __test_computeHealth([], [doneTask, task({ id: 't2', dueDate: '2026-08-01' })], now, 0);
    const withHabit = __test_computeHealth([], [doneTask, habit({ id: 'h2', startDate: todayStr, completions: [] })], now, 0);
    const withSub   = __test_computeHealth([subGoal({ id: 's2', createdAt: now })], [doneTask], now, 0);

    // Adding a sub-goal lifts "filled out" more than a habit, which lifts it
    // more than a plain task.
    expect(withSub).toBeGreaterThan(withHabit);
    expect(withHabit).toBeGreaterThan(withTask);
  });

  it('a skipped habit day (red pill) lowers deadline-goal health — skip counts as a miss', () => {
    vi.setSystemTime(now);

    const comps = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
    // Same habit; the only difference is whether a recent scheduled day was
    // explicitly skipped. The skip must register as a miss, lowering health.
    const forgiven = habit({ id: 'k', startDate: '2026-07-01', completions: comps, streak: 5 });
    const counted = habit({
      id: 'k', startDate: '2026-07-01', completions: comps, streak: 5,
      skippedDates: ['2026-06-30'],
    });

    expect(__test_computeHealth([], [counted], now, 0))
      .toBeLessThan(__test_computeHealth([], [forgiven], now, 0));
  });

  it('a new empty sub-goal genuinely RAISES health when structure has headroom (not just never-lowers)', () => {
    vi.setSystemTime(now);

    // Mirrors a real goal: 1 fresh habit (no completions yet) + a few open,
    // undated tasks + one completed task. Structure isn't already saturated,
    // so a brand-new, empty sub-goal should visibly lift the score — not
    // vanish into an already-maxed dimension.
    const freshHabit = habit({ id: 'h', recurrence: 'weekdays', startDate: '2026-07-11', completions: [] });
    const doneTask = task({ id: 'done', completed: true, completedAt: now - 4 * day });
    const openA = task({ id: 'open-a' });
    const openB = task({ id: 'open-b' });
    const before = __test_computeHealth([], [freshHabit, doneTask, openA, openB], now, 0);

    const newSub = subGoal({ id: 'new-sub', createdAt: now });
    const after = __test_computeHealth([newSub], [freshHabit, doneTask, openA, openB], now, 0);

    expect(after).toBeGreaterThan(before);
  });

  it('an overdue undone task scales health down (missed deadline bites)', () => {
    vi.setSystemTime(now);

    const doneTask = task({ id: 'done', completed: true, completedAt: now - day, dueDate: '2026-07-01' });
    const base = __test_computeHealth([], [doneTask], now, 0);

    const overdueTask = task({ id: 'late', dueDate: '2026-06-20' });
    const withOverdue = __test_computeHealth([], [doneTask, overdueTask], now, 0);

    expect(withOverdue).toBeLessThan(base);
  });
});
