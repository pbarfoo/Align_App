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
});
