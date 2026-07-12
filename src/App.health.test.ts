import { describe, expect, it, vi } from 'vitest';
import { __test_computeOngoingHealth, __test_computeHealth } from './App';
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

describe('ongoing goal health', () => {
  it('keeps an active task off the floor but modest without a recurring habit', () => {
    vi.setSystemTime(now);

    // A queued task alone no longer reads as "healthy maintenance" — a higher
    // bar means sustained recurring work is required to score high.
    const health = __test_computeOngoingHealth([], [task({ dueDate: '2026-07-10' })], 1);

    expect(health).toBeGreaterThan(0);
    expect(health).toBeLessThan(0.4);
  });

  it('rewards a consistently-kept recurring habit (age-aware) as the top signal', () => {
    vi.setSystemTime(now);

    const health = __test_computeOngoingHealth([], [habit({
      completions: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'],
      streak: 6,
    })], 1);

    expect(health).toBeGreaterThan(0.75);
  });

  it('does not let a lone recent touch reach the top, and decays over time', () => {
    vi.setSystemTime(now);

    const touchedRecently = __test_computeOngoingHealth([subGoal({ completedAt: now - 3 * day })], [], 1);
    const touchedLongAgo = __test_computeOngoingHealth([subGoal({ completedAt: now - 45 * day })], [], 1);

    expect(touchedRecently).toBeGreaterThan(0.15); // off the floor
    expect(touchedRecently).toBeLessThan(0.6);      // but not "great maintenance"
    expect(touchedLongAgo).toBeLessThan(touchedRecently);
    expect(touchedLongAgo).toBeGreaterThan(0);
  });

  it('rewards completing an ongoing task more than merely adding another open task', () => {
    vi.setSystemTime(now);

    const open = task({ id: 'h-open', dueDate: '2026-07-10' });
    const completed = task({
      id: 'h-done',
      dueDate: '2026-07-10',
      completed: true,
      completedAt: now,
    });

    const openOnly = __test_computeOngoingHealth([], [open], 1);
    const withCompleted = __test_computeOngoingHealth([], [completed], 1);
    const withExtraOpen = __test_computeOngoingHealth([], [completed, open], 1);

    expect(withCompleted - openOnly).toBeGreaterThan(0.08);
    expect(withExtraOpen).toBeGreaterThanOrEqual(withCompleted);
  });

  it('does not dilute recent completed task credit when another open task is added', () => {
    vi.setSystemTime(now);

    const completedA = task({ id: 'h-done-a', completed: true, completedAt: now });
    const completedB = task({ id: 'h-done-b', completed: true, completedAt: now - day });
    const open = task({ id: 'h-open', dueDate: '2026-07-10' });

    const completedOnly = __test_computeOngoingHealth([], [completedA, completedB], 1);
    const withOpenTask = __test_computeOngoingHealth([], [completedA, completedB, open], 1);

    expect(withOpenTask).toBeGreaterThanOrEqual(completedOnly);
  });

  it('keeps moving the score after several ongoing task completions', () => {
    vi.setSystemTime(now);

    const completed = [0, 1, 2, 3].map((i) =>
      task({ id: `h-done-${i}`, completed: true, completedAt: now - i * day }),
    );
    const openTasks = [0, 1, 2].map((i) => task({ id: `h-open-${i}`, dueDate: '2026-07-10' }));

    const before = __test_computeOngoingHealth([], [...completed, ...openTasks], 1);
    const afterAdd = __test_computeOngoingHealth([], [
      ...completed,
      ...openTasks,
      task({ id: 'h-new-open' }),
    ], 1);
    const afterComplete = __test_computeOngoingHealth([], [
      ...completed,
      task({ id: 'h-new-done', completed: true, completedAt: now }),
      ...openTasks,
    ], 1);

    expect(afterAdd - before).toBeGreaterThan(0.009);
    expect(afterComplete - before).toBeGreaterThan(0.05);
  });

  it('adding a brand-new habit does not lower ongoing health (only maturing then neglecting it does)', () => {
    vi.setSystemTime(now);
    const todayStr = '2026-07-06';

    const doneTask = task({ id: 'od', completed: true, completedAt: now - day });
    const base = __test_computeOngoingHealth([], [doneTask], 0);

    // A freshly-created daily habit (starts today, no completions yet) is
    // neutral — it must not drag the score down the moment it's added.
    const freshHabit = habit({ id: 'fresh', startDate: todayStr, completions: [] });
    const withFreshHabit = __test_computeOngoingHealth([], [doneTask, freshHabit], 0);

    // A future/undated task is likewise neutral.
    const futureTask = task({ id: 'fut', dueDate: '2026-08-01' });
    const withFutureTask = __test_computeOngoingHealth([], [doneTask, futureTask], 0);

    expect(withFreshHabit).toBeGreaterThanOrEqual(base);
    expect(withFutureTask).toBeGreaterThanOrEqual(base);
  });

  it('scales the focus adjustment by priority strength instead of an all-or-nothing flag', () => {
    vi.setSystemTime(now);

    // A moderately weak goal (base health well below 0.5, but not so weak it
    // hits the 0.02 floor) — the negative focus adjustment should shrink
    // toward zero as priority strength drops from full (#1) to none (well
    // below the top few positions), landing strictly in between at 0.5.
    const weakGoal = [subGoal({ completedAt: now - 3 * day })];
    const noFocus = __test_computeOngoingHealth(weakGoal, [], 0);
    const halfFocus = __test_computeOngoingHealth(weakGoal, [], 0.5);
    const fullFocus = __test_computeOngoingHealth(weakGoal, [], 1);

    // Full priority strength penalises a weak goal hardest; no priority
    // strength (e.g. 4th+ position) leaves it unadjusted; half strength lands
    // strictly in between — not equal to either end.
    expect(fullFocus).toBeLessThan(halfFocus);
    expect(halfFocus).toBeLessThan(noFocus);
  });
});

describe('deadline goal health — adding structure never lowers it', () => {
  const elapsed = 0.3;
  const todayStr = '2026-07-06';

  it('a future task, a fresh habit, or a new sub-goal added to a goal does not drop health', () => {
    vi.setSystemTime(now);

    const doneTask = task({ id: 'done', completed: true, completedAt: now - day, dueDate: '2026-07-01' });
    const base = __test_computeHealth([], [doneTask], [doneTask], now, elapsed, 0);

    // Not-yet-due task: future work, not a miss.
    const futureTask = task({ id: 'fut', dueDate: '2026-08-01' });
    const withFuture = __test_computeHealth([], [doneTask, futureTask], [doneTask, futureTask], now, elapsed, 0);

    // Brand-new daily habit (starts today, no completions): neutral until it
    // has had its first interval to be done.
    const freshHabit = habit({ id: 'fresh', startDate: todayStr, completions: [] });
    const withHabit = __test_computeHealth([], [doneTask, freshHabit], [doneTask, freshHabit], now, elapsed, 0);

    // Brand-new empty sub-goal (created just now): neutral to the parent.
    const newSub = subGoal({ id: 'newsub', createdAt: now });
    const withSub = __test_computeHealth([newSub], [doneTask], [doneTask], now, elapsed, 0);

    expect(withFuture).toBeGreaterThanOrEqual(base);
    expect(withHabit).toBeGreaterThanOrEqual(base);
    expect(withSub).toBeGreaterThanOrEqual(base);
  });

  it('an overdue undone task DOES weigh on health (neglect still counts)', () => {
    vi.setSystemTime(now);

    const doneTask = task({ id: 'done', completed: true, completedAt: now - day, dueDate: '2026-07-01' });
    const base = __test_computeHealth([], [doneTask], [doneTask], now, elapsed, 0);

    // Same goal, but now with an overdue, uncompleted task — this is neglect,
    // not fresh structure, so health should drop below the clean baseline.
    const overdueTask = task({ id: 'late', dueDate: '2026-06-20' });
    const withOverdue = __test_computeHealth([], [doneTask, overdueTask], [doneTask, overdueTask], now, elapsed, 0);

    expect(withOverdue).toBeLessThan(base);
  });
});
