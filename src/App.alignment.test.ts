import { describe, expect, it, vi } from 'vitest';
import { __test_valueAlignmentScore as vaScore, __test_valueAlignmentTier as vaTier } from './App';
import type { Domain, Goal, Habit, ReflectionEntry } from './data';

const day = 86_400_000;
const now = new Date('2026-07-06T12:00:00Z').getTime();
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// A single domain "career" whose value index 0 is "Leadership".
const domains: Domain[] = [
  {
    id: 'career',
    name: 'Career',
    blurb: '',
    values: ['Leadership', 'Autonomy'],
    vision: '',
  },
];
const KEY = 'career:Leadership'; // value index 0

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g',
    domainId: 'career',
    valueIndexes: [0], // tagged with Leadership
    horizon: 'ongoing',
    title: 'Goal',
    createdAt: now,
    timeframe: 1,
    ...overrides,
  };
}

function task(overrides: Partial<Habit>): Habit {
  return {
    id: 'h-task',
    goalId: 'g',
    title: 'Task',
    kind: 'task',
    doneToday: false,
    completed: false,
    createdAt: now,
    ...overrides,
  };
}

function habit(overrides: Partial<Habit>): Habit {
  return {
    id: 'h-habit',
    goalId: 'g',
    title: 'Habit',
    kind: 'habit',
    doneToday: false,
    recurrence: 'daily',
    startDate: ymd(now),
    completions: [],
    streak: 0,
    createdAt: now,
    ...overrides,
  };
}

function refl(score: number, date = now): ReflectionEntry {
  return { weekNumber: 1, date, scores: { [KEY]: score }, note: '' };
}

const score = (goals: Goal[], habits: Habit[], reflections: ReflectionEntry[]) =>
  vaScore(KEY, goals, habits, reflections, domains);

describe('value alignment — reflection-first, multi-element blend', () => {
  it('a value with nothing (no reflection, no goals) scores 0', () => {
    vi.setSystemTime(now);
    expect(score([], [], [])).toBe(0);
  });

  it('reflection alone drives the score when the value has no tagged goals', () => {
    vi.setSystemTime(now);
    // Reflection scale is 0–3; a fresh 3 → full 10 (no other element present).
    expect(score([], [], [refl(3)])).toBeCloseTo(10, 5);
    expect(score([], [], [refl(0)])).toBeCloseTo(0, 5);
  });

  it('reflection is the majority voice — it dominates the blend and keeps a strong rating high despite weak behaviour', () => {
    vi.setSystemTime(now);
    // Identical weak-but-PRESENT behaviour (a matured daily habit barely kept,
    // with skips), so all behavioural elements are live in both cases.
    const weakItems = (): Habit[] => [
      habit({
        id: 'k',
        startDate: ymd(now - 30 * day),
        completions: [ymd(now - 20 * day)],
        skippedDates: [ymd(now - 2 * day), ymd(now - 3 * day)],
      }),
    ];
    const hi = score([goal()], weakItems(), [refl(3)]);
    const lo = score([goal()], weakItems(), [refl(0)]);
    // Reflection (weight 0.55 of a full 1.0) swings the score by ~5.5 on its own.
    expect(hi - lo).toBeGreaterThan(3);
    // And a strong self-rating keeps the value high even though behaviour is weak.
    expect(hi).toBeGreaterThan(5.5);
  });

  it('behaviour corroborates: acting on the value lifts a mid reflection', () => {
    vi.setSystemTime(now);
    const mid = [refl(1.5)]; // 0.5 on the 0–1 scale
    const idle = score([goal()], [], mid);
    const active = score(
      [goal()],
      [
        task({ id: 't1', completed: true, completedAt: now }),
        task({ id: 't2', completed: true, completedAt: now - 2 * day }),
        habit({ id: 'k', completions: [ymd(now), ymd(now - day), ymd(now - 2 * day)] }),
      ],
      mid,
    );
    expect(active).toBeGreaterThan(idle);
  });

  it('goal health is only a SMALL voice — a health-only hit barely moves alignment', () => {
    vi.setSystemTime(now);
    const refls = [refl(2)];
    // Both states already have behaviour (a completed task), so `actions` and
    // `consistency` are identical between them. Adding an open, badly-overdue
    // task tanks goal HEALTH (overdue penalty) without changing actions (it's
    // not completed) or consistency (not a habit) — isolating the health
    // element (weight 0.12).
    const done = task({ id: 'done', completed: true, completedAt: now });
    const clean = score([goal()], [done], refls);
    const withOverdue = score(
      [goal()],
      [done, task({ id: 'late', dueDate: ymd(now - 20 * day) })],
      refls,
    );
    expect(Math.abs(clean - withOverdue)).toBeLessThan(1.0);
  });

  it('the behaviour ramp softens the first-signal dip — one overdue task eases alignment down, not a cliff', () => {
    vi.setSystemTime(now);
    const refls = [refl(2)];
    // No behaviour yet → reflection carries the score fully (empty goal).
    const idle = score([goal()], [], refls);
    // A single overdue task is only a little evidence (confidence ρ = 1/(1+K)
    // is small), so its behavioural weight is small and the dip is gentle.
    const oneOverdue = score([goal()], [task({ id: 'late', dueDate: ymd(now - 20 * day) })], refls);
    expect(oneOverdue).toBeLessThan(idle); // it does register...
    expect(idle - oneOverdue).toBeLessThan(1.2); // ...but only gently (was ~2.6 with a hard gate)
  });

  it('behaviour without any reflection is capped below "fully aligned"', () => {
    vi.setSystemTime(now);
    // Heavy recent activity, but the user has never reflected on this value.
    const busy = score(
      [goal()],
      Array.from({ length: 10 }, (_, i) =>
        task({ id: `t${i}`, completed: true, completedAt: now - i * day }),
      ),
      [],
    );
    expect(busy).toBeGreaterThan(0);
    expect(busy).toBeLessThanOrEqual(7 + 1e-9); // VA_NO_REFLECTION_CAP = 0.7 → 7/10
  });

  it('skipping a committed habit lowers consistency, nudging alignment down', () => {
    vi.setSystemTime(now);
    const refls = [refl(1.5)];
    const comps = [ymd(now), ymd(now - day), ymd(now - 2 * day)];
    const kept = score([goal()], [habit({ id: 'k', completions: comps })], refls);
    const skipped = score(
      [goal()],
      [habit({ id: 'k', completions: comps, skippedDates: [ymd(now - 3 * day), ymd(now - 4 * day)] })],
      refls,
    );
    expect(skipped).toBeLessThan(kept);
  });

  it('tiers a value: untracked when nothing exists, attention when low, aligned when high', () => {
    vi.setSystemTime(now);
    const tier = (goals: Goal[], habits: Habit[], reflections: ReflectionEntry[]) =>
      vaTier(KEY, goals, habits, reflections, domains).tier;

    // No reflection and no tagged goal → not yet rated (distinct from a low score).
    expect(tier([], [], [])).toBe('untracked');
    // A tagged goal but no reflection → tracked; empty goal reads low → attention.
    expect(tier([goal()], [], [])).toBe('attention');
    // A weak self-rating → attention; a strong one → aligned.
    expect(tier([], [], [refl(0.9)])).toBe('attention'); // ~30%
    expect(tier([], [], [refl(3)])).toBe('aligned'); // 100%
  });

  it('recent reflections outweigh older ones (decayed average)', () => {
    vi.setSystemTime(now);
    // A lone reflection averages to itself regardless of age; decay only tilts
    // the weighting BETWEEN reflections of different ages.
    const recentHigh = score([], [], [refl(3, now), refl(0, now - 84 * day)]);
    const recentLow = score([], [], [refl(0, now), refl(3, now - 84 * day)]);
    expect(recentHigh).toBeGreaterThan(recentLow);
  });
});
