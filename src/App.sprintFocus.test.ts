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

  it('banks the full days a goal held as the sprint focus when the focus moves off it', () => {
    const day = 86_400_000;
    const now = Date.UTC(2026, 6, 10, 12, 0, 0); // 2026-07-10T12:00Z
    // 'a' has been the focus since 3 days ago; moving the sprint to 'b' must
    // record the full days it held so the health bonus survives the switch.
    const goals = [g('a', { sprintFocusAt: now - 3 * day }), g('b')];
    const next = applySprintFocus(goals, 'b', now);
    const a = next.find((x) => x.id === 'a')!;
    expect(a.sprintFocusAt).toBeUndefined(); // focus moved off
    // The set-date itself is excluded (needs "an entire day"); the three full
    // days since are banked.
    expect(a.sprintFocusDays).toEqual(['2026-07-08', '2026-07-09', '2026-07-10']);
    expect(next.find((x) => x.id === 'b')!.sprintFocusAt).toBe(now);
  });
});
