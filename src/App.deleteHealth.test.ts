import { describe, expect, it } from 'vitest';
import {
  __test_computeHealth,
  __test_dropRetainedCredits,
  __test_goalEarnedNet,
  __test_retainHealthOnDelete,
  __test_subGoalHalfLife,
  __test_subGoalScale,
} from './App';
import type { Goal, Habit } from './data';

/**
 * Deleting never lowers health.
 *
 * Health is a tally over the items a goal holds, so removing one used to erase
 * its credit retroactively — deleting a finished task made it look like the work
 * had never happened. `retainHealthOnDelete` banks what the delete cost as a
 * dated credit, so the score holds AND keeps decaying on the original curve.
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
    createdAt: now - 40 * day,
    timeframe: 3,
    ...overrides,
  };
}

function task(id: string, goalId: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id, goalId, title: id, kind: 'task', doneToday: false,
    createdAt: now - 20 * day,
    ...overrides,
  };
}

function habit(id: string, goalId: string, completionDays: number[]): Habit {
  return {
    id, goalId, title: id, kind: 'habit', doneToday: false,
    recurrence: 'daily',
    startDate: ymd(now - 30 * day),
    createdAt: now - 30 * day,
    completions: completionDays.map((d) => ymd(now - d * day)),
    streak: 0,
  };
}

/** The health one goal displays — mirrors what the metric wrappers compute. */
function health(g: Goal, goals: Goal[], habits: Habit[], at = now): number {
  const subGoals   = goals.filter((x) => x.parentGoalId === g.id);
  const subtree    = new Set<string>([g.id, ...subGoals.map((x) => x.id)]);
  const treeHabits = habits.filter((h) => subtree.has(h.goalId));
  return __test_computeHealth(
    subGoals, treeHabits, at, 0, __test_subGoalHalfLife(g, goals),
    g.createdAt, undefined, undefined, __test_subGoalScale(g), g.retainedCredits,
  );
}

/** Run a delete: drop `removedGoalIds` + `removedHabitIds`, retaining health. */
function del(
  goals: Goal[], habits: Habit[],
  { goalIds = [] as string[], habitIds = [] as string[] },
  ref = 'del-1',
): { goals: Goal[]; habits: Habit[] } {
  const nextGoals  = goals.filter((g) => !goalIds.includes(g.id));
  const nextHabits = habits.filter((h) => !habitIds.includes(h.id) && !goalIds.includes(h.goalId));
  return {
    goals: __test_retainHealthOnDelete(goals, habits, nextGoals, nextHabits, ref, now),
    habits: nextHabits,
  };
}

const find = (goals: Goal[], id: string) => goals.find((g) => g.id === id)!;

describe('deleting an item never lowers health', () => {
  it('holds health when a completed task is deleted', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [
      task('t1', 'g', { completed: true, completedAt: now - 3 * day }),
      task('t2', 'g', { dueDate: ymd(now + 5 * day) }),
    ];
    const before = health(goals[0], goals, habits);
    expect(before).toBeGreaterThan(0);

    const after = del(goals, habits, { habitIds: ['t1'] });
    expect(health(find(after.goals, 'g'), after.goals, after.habits)).toBeCloseTo(before, 10);
  });

  it('holds health when a well-kept habit is deleted', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [habit('h1', 'g', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])];
    const before = health(goals[0], goals, habits);

    const after = del(goals, habits, { habitIds: ['h1'] });
    expect(health(find(after.goals, 'g'), after.goals, after.habits)).toBeCloseTo(before, 10);
  });

  it('holds the parent’s health when a completed sub-goal is deleted', () => {
    const parent = goal({ id: 'p', horizon: 'long', timeframe: 5 });
    const sub    = goal({ id: 's', parentGoalId: 'p', createdAt: now - 30 * day, completedAt: now - 2 * day });
    const goals  = [parent, sub];
    const habits = [task('t1', 's', { completed: true, completedAt: now - 4 * day })];
    const before = health(parent, goals, habits);

    // The whole branch goes: the sub-goal (+10 built, +40 completed) and its task.
    const after = del(goals, habits, { goalIds: ['s'] });
    expect(after.goals).toHaveLength(1);
    expect(health(find(after.goals, 'p'), after.goals, after.habits)).toBeCloseTo(before, 10);
  });

  it('holds health when a whole multi-item branch is deleted at once', () => {
    const parent = goal({ id: 'p', horizon: 'long', timeframe: 5 });
    const sub    = goal({ id: 's', parentGoalId: 'p', createdAt: now - 30 * day });
    const goals  = [parent, sub];
    const habits = [
      habit('h1', 's', [0, 2, 4, 6, 8]),
      task('t1', 's', { completed: true, completedAt: now - day }),
      task('t2', 'p', { completed: true, completedAt: now - 6 * day }),
    ];
    const before = health(parent, goals, habits);

    const after = del(goals, habits, { goalIds: ['s'] });
    expect(after.habits.map((h) => h.id)).toEqual(['t2']);
    expect(health(find(after.goals, 'p'), after.goals, after.habits)).toBeCloseTo(before, 10);
  });
});

describe('the retained credit behaves like the items it replaces', () => {
  it('keeps decaying on the same curve — not a permanent floor', () => {
    const goals  = [goal({ id: 'g', horizon: 'long', timeframe: 5 })];
    const habits = [habit('h1', 'g', [0, 1, 2, 3, 4, 5])];
    const after  = del(goals, habits, { habitIds: ['h1'] });

    for (const ahead of [7, 30, 90]) {
      const at = now + ahead * day;
      // What the goal WOULD have read had the habit stayed, vs what it reads
      // with the banked credit standing in for it.
      expect(health(find(after.goals, 'g'), after.goals, after.habits, at))
        .toBeCloseTo(health(goals[0], goals, habits, at), 10);
    }
  });

  it('banks nothing on goals the delete did not touch', () => {
    const goals  = [goal({ id: 'g' }), goal({ id: 'other', createdAt: now - 10 * day })];
    const habits = [task('t1', 'g', { completed: true, completedAt: now - day })];
    const after  = del(goals, habits, { habitIds: ['t1'] });

    expect(find(after.goals, 'g').retainedCredits).toHaveLength(1);
    expect(find(after.goals, 'other').retainedCredits).toBeUndefined();
  });

  it('is taken back by Undo, so restoring the item does not double-count it', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [habit('h1', 'g', [0, 1, 2, 3])];
    const before = health(goals[0], goals, habits);

    const after    = del(goals, habits, { habitIds: ['h1'] }, 'del-undo-me');
    const undone   = __test_dropRetainedCredits(after.goals, 'del-undo-me');
    expect(find(undone, 'g').retainedCredits).toBeUndefined();
    // Habit restored + credit withdrawn = exactly where we started.
    expect(health(find(undone, 'g'), undone, habits)).toBeCloseTo(before, 10);
  });

  it('leaves credits from OTHER deletes alone when one is undone', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [
      habit('h1', 'g', [0, 1, 2]),
      habit('h2', 'g', [1, 3, 5]),
    ];
    const first  = del(goals, habits, { habitIds: ['h1'] }, 'del-a');
    const second = del(first.goals, first.habits, { habitIds: ['h2'] }, 'del-b');
    expect(find(second.goals, 'g').retainedCredits).toHaveLength(2);

    const undone = __test_dropRetainedCredits(second.goals, 'del-b');
    expect(find(undone, 'g').retainedCredits?.map((c) => c.ref)).toEqual(['del-a']);
  });
});

describe('relief still flows the other way', () => {
  it('deleting an open overdue task RAISES health and banks no credit', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [task('t1', 'g', { dueDate: ymd(now - 20 * day) })];
    const before = health(goals[0], goals, habits);

    const after = del(goals, habits, { habitIds: ['t1'] });
    expect(find(after.goals, 'g').retainedCredits).toBeUndefined();
    expect(health(find(after.goals, 'g'), after.goals, after.habits)).toBeGreaterThan(before);
  });

  it('banks only the shortfall when a delete removes credit AND a penalty', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [
      // Long overdue: the −10 drag outweighs the +2 build-out it earned.
      task('t1', 'g', { dueDate: ymd(now - 30 * day) }),
      task('t2', 'g', { completed: true, completedAt: now - day }),
    ];
    const netBefore = __test_goalEarnedNet(goals[0], goals, habits, now);
    // Delete both at once: the completed task's credit is banked, the overdue
    // task's penalty is simply gone, so the net can only improve.
    const after = del(goals, habits, { habitIds: ['t1', 't2'] });
    const g = find(after.goals, 'g');
    const netAfter = __test_goalEarnedNet(g, after.goals, after.habits, now)
      + (g.retainedCredits ?? []).reduce((s, c) => s + c.points, 0);
    expect(netAfter).toBeGreaterThanOrEqual(netBefore - 1e-9);
  });
});
