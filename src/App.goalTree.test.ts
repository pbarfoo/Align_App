import { describe, expect, it } from 'vitest';
import { expandGoalSubtrees, goalSubtreeIds } from './App';
import type { Goal } from './data';

/**
 * The shared goal-tree walk. Archiving, the sprint-focus subtree, and the
 * delete cascade all run through this, so it has to be order-independent:
 * `sortOrder` is renumbered globally on every drag, which gives no guarantee
 * that a parent sits before its children in the goals array.
 *
 * The delete cascade used to be a SINGLE pass over that array, so a grandchild
 * listed before its parent survived a delete of the root and was left with a
 * parentGoalId pointing at a goal that no longer existed. An orphan like that
 * renders nowhere in Align (sub-goals only ever render nested under a parent)
 * while still counting toward goal health and the Today lists — a permanently
 * invisible goal.
 */

const g = (id: string, parentGoalId?: string): Goal => ({
  id,
  domainId: 'family',
  valueIndexes: [],
  horizon: 'short',
  title: id,
  createdAt: 0,
  timeframe: 1,
  ...(parentGoalId ? { parentGoalId } : {}),
});

// root → mid → {leafA, leafB}: the shape that exists in live data
// (Financial Security → Lower Monthly Expenses → lease / storage).
const tree = [g('root'), g('mid', 'root'), g('leafA', 'mid'), g('leafB', 'mid')];

describe('goalSubtreeIds', () => {
  it('collects the whole subtree, not just direct children', () => {
    expect([...goalSubtreeIds(tree, 'root')].sort())
      .toEqual(['leafA', 'leafB', 'mid', 'root']);
  });

  it('reaches grandchildren regardless of array order', () => {
    // Deepest-first — the order a single forward pass gets wrong.
    const reversed = [...tree].reverse();
    expect([...goalSubtreeIds(reversed, 'root')].sort())
      .toEqual(['leafA', 'leafB', 'mid', 'root']);

    // Grandchildren before the parent that links them to the root.
    const shuffled = [g('leafA', 'mid'), g('leafB', 'mid'), g('root'), g('mid', 'root')];
    expect([...goalSubtreeIds(shuffled, 'root')].sort())
      .toEqual(['leafA', 'leafB', 'mid', 'root']);
  });

  it('returns just the goal itself when it has no sub-goals', () => {
    expect([...goalSubtreeIds(tree, 'leafA')]).toEqual(['leafA']);
  });

  it('takes a mid-branch root without pulling in its ancestors', () => {
    expect([...goalSubtreeIds(tree, 'mid')].sort()).toEqual(['leafA', 'leafB', 'mid']);
  });

  it('does not hang on a parent cycle', () => {
    const cyclic = [g('a', 'b'), g('b', 'a')];
    expect([...goalSubtreeIds(cyclic, 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('expandGoalSubtrees', () => {
  it('grows several roots at once', () => {
    const forest = [...tree, g('other'), g('otherKid', 'other')];
    expect([...expandGoalSubtrees(forest, ['mid', 'other'])].sort())
      .toEqual(['leafA', 'leafB', 'mid', 'other', 'otherKid']);
  });

  it('is empty for no roots', () => {
    expect(expandGoalSubtrees(tree, []).size).toBe(0);
  });
});
