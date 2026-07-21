import { describe, expect, it } from 'vitest';
import { __test_applySprintFocus as applySprintFocus } from './App';
import type { Goal } from './data';

const g = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id,
  domainId: 'career',
  valueIndexes: [],
  horizon: 'short',
  title: id,
  createdAt: 0,
  timeframe: 3,
  ...extra,
});

describe('applySprintFocus (single-select)', () => {
  it('stamps the chosen goal and leaves the rest unfocused', () => {
    const goals = [g('a'), g('b'), g('c')];
    const next = applySprintFocus(goals, 'b', 1000);
    expect(next.find((x) => x.id === 'b')!.sprintFocusAt).toBe(1000);
    expect(next.find((x) => x.id === 'a')!.sprintFocusAt).toBeUndefined();
    expect(next.find((x) => x.id === 'c')!.sprintFocusAt).toBeUndefined();
  });

  it('moves the focus off a previous goal — never two at once', () => {
    const goals = [g('a', { sprintFocusAt: 500 }), g('b')];
    const next = applySprintFocus(goals, 'b', 1000);
    expect(next.find((x) => x.id === 'a')!.sprintFocusAt).toBeUndefined();
    expect(next.find((x) => x.id === 'b')!.sprintFocusAt).toBe(1000);
    expect(next.filter((x) => x.sprintFocusAt).length).toBe(1);
  });

  it('toggles off when re-selecting the current focus', () => {
    const goals = [g('a', { sprintFocusAt: 500 }), g('b')];
    const next = applySprintFocus(goals, 'a', 1000);
    expect(next.every((x) => x.sprintFocusAt === undefined)).toBe(true);
  });

  it('preserves object identity for rows that do not change', () => {
    const goals = [g('a', { sprintFocusAt: 500 }), g('b')];
    const next = applySprintFocus(goals, 'a', 1000);
    // 'b' had no focus before or after → same reference, no needless churn.
    expect(next.find((x) => x.id === 'b')).toBe(goals[1]);
  });
});
