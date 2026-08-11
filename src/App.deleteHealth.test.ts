import { describe, expect, it, vi } from 'vitest';
import {
  __test_valueAlignmentScore as vaScore,
  __test_computeHealth,
  __test_dropRetainedCredits,
  __test_goalEarnedNet,
  __test_retainHealthOnDelete,
  __test_subGoalHalfLife,
  __test_subGoalScale,
} from './App';
import type { Domain, Goal, Habit, ReflectionEntry } from './data';

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
  it('deleting an open overdue task RAISES health and banks no health points', () => {
    const goals  = [goal({ id: 'g' })];
    const habits = [task('t1', 'g', { dueDate: ymd(now - 20 * day) })];
    const before = health(goals[0], goals, habits);

    const after = del(goals, habits, { habitIds: ['t1'] });
    // The overdue task was judgeable behaviour, so its evidence is retained for
    // alignment's confidence ramp — but it earned no health, so nothing is
    // banked there and the goal simply gets the penalty relief.
    const credits = find(after.goals, 'g').retainedCredits ?? [];
    expect(credits.map((c) => c.points)).toEqual([0]);
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

/* ---- Value alignment gets the same treatment ------------------------------
 * Alignment has its own two behavioural ledgers that a delete used to dent:
 * "lived actions" (its own weights, 28-day clock) and the evidence count behind
 * the confidence ramp. Both are banked alongside the health credit. */

const domains: Domain[] = [
  { id: 'career', name: 'Career', blurb: '', values: ['Leadership', 'Autonomy'], vision: '' },
];
const KEY = 'career:Leadership'; // value index 0

const tagged = (overrides: Partial<Goal> = {}) =>
  goal({ horizon: 'ongoing', valueIndexes: [0], ...overrides });

const refl = (s: number): ReflectionEntry =>
  ({ weekNumber: 1, date: now - 3 * day, scores: { [KEY]: s }, note: '' });

const align = (goals: Goal[], habits: Habit[], reflections: ReflectionEntry[] = [refl(2)]) =>
  vaScore(KEY, goals, habits, reflections, domains);

describe('deleting an item never lowers value alignment either', () => {
  it('holds alignment when a completed task is deleted', () => {
    vi.setSystemTime(now);
    const goals  = [tagged({ id: 'g' })];
    const habits = [
      task('t1', 'g', { completed: true, completedAt: now - 5 * day }),
      task('t2', 'g', { completed: true, completedAt: now - 12 * day }),
    ];
    const before = align(goals, habits);

    const after = del(goals, habits, { habitIds: ['t1'] });
    expect(align(after.goals, after.habits)).toBeCloseTo(before, 10);
  });

  it('holds alignment when a kept habit is deleted', () => {
    vi.setSystemTime(now);
    const goals  = [tagged({ id: 'g' })];
    const habits = [habit('h1', 'g', [0, 1, 2, 3, 4, 5, 6, 7])];
    const before = align(goals, habits);

    const after = del(goals, habits, { habitIds: ['h1'] });
    expect(align(after.goals, after.habits)).toBeCloseTo(before, 10);
  });

  it('holds alignment when a completed sub-goal branch is deleted', () => {
    vi.setSystemTime(now);
    // The sub-goal inherits the value from its tagged parent, so its actions
    // count toward the value — and must keep counting once it's deleted.
    const parent = tagged({ id: 'p' });
    const sub    = goal({ id: 's', parentGoalId: 'p', valueIndexes: [], completedAt: now - 4 * day });
    const goals  = [parent, sub];
    const habits = [
      task('t1', 's', { completed: true, completedAt: now - 6 * day }),
      habit('h1', 's', [1, 3, 5, 7]),
    ];
    const before = align(goals, habits);

    const after = del(goals, habits, { goalIds: ['s'] });
    expect(after.goals.map((g) => g.id)).toEqual(['p']);
    // The whole branch's lived actions and evidence were pushed up to the
    // surviving parent — the milestone, the task, and the habit-days.
    const credits = find(after.goals, 'p').retainedCredits!;
    const credit  = credits[credits.length - 1];
    expect(credit.actionPoints).toBeGreaterThan(0);
    expect(credit.evidence).toBe(3);
    expect(credit.keptDays).toHaveLength(4);
    // Alignment can't fall. It may tick UP, because the goal-health element
    // averages over the goals that still exist and the deleted branch is no
    // longer in that average — see the note on the residual in AGENTS.md.
    expect(align(after.goals, after.habits)).toBeGreaterThanOrEqual(before - 1e-9);
  });

  it('keeps the confidence ramp where it was — deleting evidence doesn’t un-know it', () => {
    vi.setSystemTime(now);
    const goals  = [tagged({ id: 'g' })];
    const habits = [
      task('t1', 'g', { completed: true, completedAt: now - 2 * day }),
      task('t2', 'g', { completed: true, completedAt: now - 9 * day }),
      habit('h1', 'g', [0, 2, 4]),
    ];
    const after = del(goals, habits, { habitIds: ['t1', 't2', 'h1'] });
    const credit = find(after.goals, 'g').retainedCredits![0];
    expect(credit.evidence).toBe(3);
    expect(align(after.goals, after.habits)).toBeCloseTo(align(goals, habits), 10);
  });

  it('decays alignment credit on alignment’s own 28-day clock', () => {
    const goals  = [tagged({ id: 'g' })];
    const habits = [habit('h1', 'g', [0, 1, 2, 3, 4])];
    const after  = del(goals, habits, { habitIds: ['h1'] });

    for (const ahead of [7, 28, 60]) {
      vi.setSystemTime(now + ahead * day);
      expect(align(after.goals, after.habits)).toBeCloseTo(align(goals, habits), 10);
    }
    vi.setSystemTime(now);
  });
});
