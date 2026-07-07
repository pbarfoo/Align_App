import { describe, expect, it, vi } from 'vitest';
import { __test_computeOngoingHealth } from './App';
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
    const health = __test_computeOngoingHealth([], [task({ dueDate: '2026-07-10' })], true);

    expect(health).toBeGreaterThan(0);
    expect(health).toBeLessThan(0.4);
  });

  it('rewards a consistently-kept recurring habit (age-aware) as the top signal', () => {
    vi.setSystemTime(now);

    const health = __test_computeOngoingHealth([], [habit({
      completions: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'],
      streak: 6,
    })], true);

    expect(health).toBeGreaterThan(0.75);
  });

  it('does not let a lone recent touch reach the top, and decays over time', () => {
    vi.setSystemTime(now);

    const touchedRecently = __test_computeOngoingHealth([subGoal({ completedAt: now - 3 * day })], [], true);
    const touchedLongAgo = __test_computeOngoingHealth([subGoal({ completedAt: now - 45 * day })], [], true);

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

    const openOnly = __test_computeOngoingHealth([], [open], true);
    const withCompleted = __test_computeOngoingHealth([], [completed], true);
    const withExtraOpen = __test_computeOngoingHealth([], [completed, open], true);

    expect(withCompleted - openOnly).toBeGreaterThan(0.08);
    expect(withExtraOpen).toBeGreaterThanOrEqual(withCompleted);
  });

  it('does not dilute recent completed task credit when another open task is added', () => {
    vi.setSystemTime(now);

    const completedA = task({ id: 'h-done-a', completed: true, completedAt: now });
    const completedB = task({ id: 'h-done-b', completed: true, completedAt: now - day });
    const open = task({ id: 'h-open', dueDate: '2026-07-10' });

    const completedOnly = __test_computeOngoingHealth([], [completedA, completedB], true);
    const withOpenTask = __test_computeOngoingHealth([], [completedA, completedB, open], true);

    expect(withOpenTask).toBeGreaterThanOrEqual(completedOnly);
  });

  it('keeps moving the score after several ongoing task completions', () => {
    vi.setSystemTime(now);

    const completed = [0, 1, 2, 3].map((i) =>
      task({ id: `h-done-${i}`, completed: true, completedAt: now - i * day }),
    );
    const openTasks = [0, 1, 2].map((i) => task({ id: `h-open-${i}`, dueDate: '2026-07-10' }));

    const before = __test_computeOngoingHealth([], [...completed, ...openTasks], true);
    const afterAdd = __test_computeOngoingHealth([], [
      ...completed,
      ...openTasks,
      task({ id: 'h-new-open' }),
    ], true);
    const afterComplete = __test_computeOngoingHealth([], [
      ...completed,
      task({ id: 'h-new-done', completed: true, completedAt: now }),
      ...openTasks,
    ], true);

    expect(afterAdd - before).toBeGreaterThan(0.009);
    expect(afterComplete - before).toBeGreaterThan(0.05);
  });
});
