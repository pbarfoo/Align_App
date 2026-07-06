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
  it('treats an active not-overdue task as healthy focus instead of zero', () => {
    vi.setSystemTime(now);

    const health = __test_computeOngoingHealth([], [task({ dueDate: '2026-07-10' })], true);

    expect(health).toBeGreaterThanOrEqual(0.6);
  });

  it('uses recurring habit completions as a strong maintenance signal', () => {
    vi.setSystemTime(now);

    const health = __test_computeOngoingHealth([], [habit({
      completions: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'],
      streak: 6,
    })], true);

    expect(health).toBeGreaterThan(0.75);
  });

  it('decays after a recent touch instead of dropping straight to zero', () => {
    vi.setSystemTime(now);

    const touchedRecently = __test_computeOngoingHealth([subGoal({ completedAt: now - 3 * day })], [], true);
    const touchedLongAgo = __test_computeOngoingHealth([subGoal({ completedAt: now - 45 * day })], [], true);

    expect(touchedRecently).toBeGreaterThan(0.5);
    expect(touchedLongAgo).toBeLessThan(touchedRecently);
    expect(touchedLongAgo).toBeGreaterThan(0);
  });
});
