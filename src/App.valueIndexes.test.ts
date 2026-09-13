import { describe, expect, it } from 'vitest';
import {
  __test_valueAlignmentScore,
  reflectionScoreForValue,
  reflectionValueKey,
  reindexGoalValuesAfterRemoval,
  reindexReflectionScoresAfterRemoval,
  removedValueIndex,
} from './App';
import type { Domain, Goal, Habit, ReflectionEntry } from './data';

const goal = (id: string, parentGoalId?: string, valueIndexes: number[] = []): Goal => ({
  id,
  domainId: 'career',
  valueIndexes,
  horizon: 'ongoing',
  title: id,
  createdAt: Date.now() - 10_000,
  timeframe: 1,
  ...(parentGoalId ? { parentGoalId } : {}),
});

describe('domain value index maintenance', () => {
  it('remaps surviving tags and drops tags for a deleted value', () => {
    const goals = [
      goal('first', undefined, [0, 1]),
      goal('second', undefined, [2]),
    ];
    expect(reindexGoalValuesAfterRemoval(goals, 'career', 1).map((g) => g.valueIndexes))
      .toEqual([[0], [1]]);
  });

  it('recognizes only a simple deletion, not a rename', () => {
    expect(removedValueIndex(['Leadership', 'Autonomy', 'Teaching'], ['Leadership', 'Teaching']))
      .toBe(1);
    expect(removedValueIndex(['Leadership', 'Autonomy'], ['Leadership', 'Freedom']))
      .toBeNull();
  });

  it('keeps canonical reflection slots aligned after a deletion', () => {
    const reflections: ReflectionEntry[] = [{
      weekNumber: 1,
      date: Date.now(),
      scores: { 'career:0': 3, 'career:1': 1, 'career:2': 2, 'self:0': 3 },
      note: '',
    }];
    const [result] = reindexReflectionScoresAfterRemoval(reflections, 'career', 1);
    expect(result.scores).toEqual({ 'career:0': 3, 'career:1': 2, 'self:0': 3 });
  });

  it('uses stable slot keys across a label rename and understands known legacy aliases', () => {
    const reflection: ReflectionEntry = {
      weekNumber: 1,
      date: Date.now(),
      scores: { 'family:Love': 2 },
      note: '',
    };
    expect(reflectionValueKey('family', 4)).toBe('family:4');
    expect(reflectionScoreForValue(reflection, 'family', 4, 'Love/Positivity')).toBe(2);
  });
});

describe('value inheritance', () => {
  it('includes grandchildren of a tagged goal', () => {
    const now = Date.now();
    const domains: Domain[] = [{
      id: 'career', name: 'Career', blurb: '', vision: '', values: ['Leadership'],
    }];
    const goals = [goal('root', undefined, [0]), goal('child', 'root'), goal('leaf', 'child')];
    const habits: Habit[] = [{
      id: 'done-leaf', goalId: 'leaf', title: 'Finish it', kind: 'task',
      doneToday: false, completed: true, completedAt: now,
    }];

    expect(__test_valueAlignmentScore('career:0', goals, habits, [], domains)).toBeGreaterThan(0);
  });
});
