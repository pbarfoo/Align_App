export type DomainId = 'career' | 'self' | 'family' | 'community';

export interface Domain {
  id: DomainId;
  name: string;
  blurb: string;
  values: string[];
  vision: string;
}

/** A cross-domain operating principle — how Patrick decides when two values
 *  collide. Distinct from `Domain.values`, which are per-domain tags the
 *  alignment engine scores goals against. Principles are read, not scored.
 *  The canonical wording is Patrick's; LifeOS.md Part 1 mirrors what is set
 *  here (see AGENTS.md — one source of truth, synced one way). */
export interface Principle {
  id: string;
  /** the short name, e.g. "Family is priority" */
  title: string;
  /** the sentence that makes it usable at a decision point */
  detail: string;
  /** position in the list — lower shows first */
  sortOrder: number;
  createdAt: number;
}

export interface Goal {
  id: string;
  domainId: DomainId;
  /** indexes into domain.values; [] means no values tagged */
  valueIndexes: number[];
  horizon: 'long' | 'short' | 'ongoing';
  title: string;
  /** short goals point to the long goal they serve */
  parentGoalId?: string;
  createdAt: number;
  /** years when horizon === 'long', months when 'short' */
  timeframe: number;
  /** unix ms when this short-term goal was marked complete */
  completedAt?: number;
  /** position in the user's priority order — first goal per domain is the
   * focus goal, so this order carries meaning and must persist */
  sortOrder?: number;
  /** unix ms when the goal was set INACTIVE (paused). Distinct from
   * completedAt (achieved): an inactive goal is parked — excluded from health,
   * the dashboard, and the Today lists — and can be reactivated at any time. */
  archivedAt?: number;
  /** unix ms when this goal was chosen as THE sprint focus — the one goal the
   * user is centring this stretch of work on. At most one goal carries this at
   * a time (selecting a new one clears the previous). undefined = not the focus. */
  sprintFocusAt?: number;
  /** YYYY-MM-DD dates on which this goal earned a "sprint focus" bonus — one per
   * full day it was held as the sprint. Banked when the focus moves elsewhere so
   * the bonus PERSISTS after the sprint ends, then decays like any other health
   * event. While the goal is still the active focus, in-progress days are derived
   * live from sprintFocusAt (not yet written here). */
  sprintFocusDays?: string[];
  /** Health points banked when something under this goal was DELETED, so that
   * removing a task / habit / sub-goal never drops the goal's health. Each entry
   * is the earned credit the deleted items were contributing at the moment they
   * were removed, dated so it keeps decaying exactly as those items would have.
   * `ref` tags the delete batch so Undo can take the credit back. */
  retainedCredits?: HealthCredit[];
}

/** One banked, decaying health credit — see `Goal.retainedCredits`. */
export interface HealthCredit {
  /** unix ms the credit was banked (the deletion time) — the decay anchor */
  at: number;
  /** points on the 0–100 health scale, pre-decay from `at`. The SCALED bucket
   * — the sub-goal / habit ledger that `subGoalScale` re-bases. */
  points: number;
  /** the same, for the UNSCALED task ledger (see `earnedLedger`), so a deleted
   * task's credit re-enters the score on the side of the scale it earned on */
  flatPoints?: number;
  /** the same loss measured on value alignment's own "lived actions" scale
   * (its own point values and 28-day clock), pre-decay from `at` */
  actionPoints?: number;
  /** count of judgeable behavioural signals the deleted items represented, for
   * value alignment's confidence ramp. A raw tally — it does not decay. */
  evidence?: number;
  /** YYYY-MM-DD habit-days the deleted items had kept / skipped, for value
   * alignment's consistency element. Kept as dates rather than a ratio so they
   * age out of its rolling window exactly as the live rows would have; only
   * dates still inside the window at deletion time are banked. */
  keptDays?: string[];
  skippedDays?: string[];
  /** delete-batch id, so an Undo can remove exactly what that delete added */
  ref?: string;
}

export type ActionKind = 'habit' | 'task';
export type Recurrence =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom'
  | 'specific-days';
export type CustomUnit = 'days' | 'weeks' | 'months' | 'years';

export interface Habit {
  id: string;
  goalId: string;
  title: string;
  kind: ActionKind;
  doneToday: boolean;
  /** unix ms when this item was added — anchors the build-out decay in the
   * health model (an item's structural credit fades from when it was created). */
  createdAt?: number;
  /** habit only */
  startDate?: string;
  recurrence?: Recurrence;
  customInterval?: number;
  customUnit?: CustomUnit;
  /** task only */
  dueDate?: string;
  dueTime?: string;
  /** task only: permanently marked done */
  completed?: boolean;
  /** unix ms of last time this habit/task was checked off */
  completedAt?: number;
  /** habit only: consecutive periods completed in a row. Derived from
   * `completions` on load (see habitFromRow) — not persisted to the DB. */
  streak?: number;
  /** habit only: "YYYY-MM-DD" strings for every logged completion */
  completions?: string[];
  /** specific-days recurrence: 0=Sun, 1=Mon … 6=Sat */
  specificDays?: number[];
  /** task only: "YYYY-MM-DD" this task was flagged (☀) as a priority for.
   * When it equals today, the task appears in Today's chosen-focus section. */
  focusDate?: string;
  /** habit only: scheduled days the user explicitly SKIPPED (the red pill).
   * The start date is advanced past them so they stop nagging, but each is
   * still counted as a miss in the consistency math — skipping ≠ forgiveness. */
  skippedDates?: string[];
}

export const domains: Domain[] = [
  {
    id: 'self',
    name: 'Self',
    blurb: 'Your mind, body, and inner life.',
    values: ['Physical Health', 'Growth', 'Maturity', 'Balance', 'Joy', 'Challenges'],
    vision:
      'To become physically healthy, emotionally steady, and genuinely at ease — growing continuously without burning out.',
  },
  {
    id: 'family',
    name: 'Family',
    blurb: 'The people and home you protect first.',
    values: ['Leadership', 'Financial Security', 'Presence', 'Integrity', 'Love/Positivity'],
    vision:
      'To be a present, loving husband and father who leads his family with integrity, warmth, and a long view — creating a stable, generous home.',
  },
  {
    id: 'career',
    name: 'Career',
    blurb: 'The work you put into the world.',
    values: ['Leadership', 'Autonomy', 'Flexibility', 'Professional Respect', 'Competence', 'Service'],
    vision:
      'To build a respected and flexible career in film and media where I have the autonomy to teach, create meaningful work, and positively contribute to others.',
  },
  {
    id: 'community',
    name: 'Community',
    blurb: 'The people and communities you serve beyond home.',
    values: ['Leadership', 'Presence', 'Integrity', 'Love/Positivity', 'Community', 'Service'],
    vision:
      'To contribute beyond home through friendship, service, stewardship, and community leadership — building relationships, strengthening shared places, and using my gifts to help others flourish.',
  },
];

const domainOrder: DomainId[] = ['self', 'family', 'career', 'community'];

export const sortDomains = (items: Domain[]): Domain[] =>
  [...items].sort((a, b) => domainOrder.indexOf(a.id) - domainOrder.indexOf(b.id));

/** Seeded for brand-new accounts only — Patrick's five, from LifeOS.md Part 1.
 *  Never repopulated once an account holds its own (same rule as seed domains):
 *  an empty table means they were deleted, not that the account is new. */
export const principles: Principle[] = [
  {
    id: 'p-family-first',
    title: 'Family is priority',
    detail: 'Home comes first when time or attention is contested.',
    sortOrder: 0,
    createdAt: 0,
  },
  {
    id: 'p-simplicity',
    title: 'Simplicity is key',
    detail: 'Don\u2019t put too much on your plate. Ask: \u201cWhat if it were simple?\u201d',
    sortOrder: 1,
    createdAt: 0,
  },
  {
    id: 'p-small-bets',
    title: 'Make small, persistent bets',
    detail:
      'When outcomes are unpredictable, keep creating opportunities without risking what matters most.',
    sortOrder: 2,
    createdAt: 0,
  },
  {
    id: 'p-finish',
    title: 'Finish what you start',
    detail:
      'Prefer closing or consciously pausing existing commitments before opening another meaningful project.',
    sortOrder: 3,
    createdAt: 0,
  },
  {
    id: 'p-challenge',
    title: 'Challenge yourself selectively',
    detail:
      'Choose challenges that advance your goals without compromising family, health, or stability.',
    sortOrder: 4,
    createdAt: 0,
  },
];

// Seed goals use realistic past start dates so the time-remaining bars
// show non-trivial values in the dashboard demo.
const d = (iso: string) => new Date(iso).getTime();

export const initialGoals: Goal[] = [
  {
    id: 'g-career-long',
    domainId: 'career',
    valueIndexes: [0, 1],
    horizon: 'long',
    title: 'Ship a product I fully own',
    createdAt: d('2025-02-01'),   // ~15 mo ago, 3-yr window → ~58% elapsed
    timeframe: 3,
  },
  {
    id: 'g-career-short',
    domainId: 'career',
    valueIndexes: [],
    horizon: 'short',
    title: 'Release the Align prototype',
    parentGoalId: 'g-career-long',
    createdAt: d('2026-03-01'),   // ~2.5 mo ago, 3-mo window → ~83% elapsed
    timeframe: 3,
  },
  {
    id: 'g-self-long',
    domainId: 'self',
    valueIndexes: [0, 2],
    horizon: 'long',
    title: 'Be able to run a half-marathon at 50',
    createdAt: d('2024-05-20'),   // ~2 yr ago, 5-yr window → ~40% elapsed
    timeframe: 5,
  },
  {
    id: 'g-self-short',
    domainId: 'self',
    valueIndexes: [],
    horizon: 'short',
    title: 'Run 3x a week through spring',
    parentGoalId: 'g-self-long',
    createdAt: d('2026-03-01'),
    timeframe: 3,
  },
  {
    id: 'g-self-short-2',
    domainId: 'self',
    valueIndexes: [],
    horizon: 'short',
    title: 'A 10-minute morning sit, daily',
    createdAt: d('2026-03-01'),
    timeframe: 3,
  },
  {
    id: 'g-comm-long',
    domainId: 'family',
    valueIndexes: [0],
    horizon: 'long',
    title: 'No regrets about time with the people I love',
    createdAt: d('2025-05-20'),   // ~1 yr ago, 5-yr window → ~20% elapsed
    timeframe: 5,
  },
  {
    id: 'g-comm-short',
    domainId: 'family',
    valueIndexes: [],
    horizon: 'short',
    title: 'One unhurried evening with family each week',
    parentGoalId: 'g-comm-long',
    createdAt: d('2026-04-20'),
    timeframe: 1,
  },
];

export const initialHabits: Habit[] = [
  {
    id: 'h1',
    goalId: 'g-career-short',
    title: 'Deep work block, no meetings',
    kind: 'habit',
    recurrence: 'weekdays',
    doneToday: true,
    completedAt: new Date('2026-05-20').getTime(),
    streak: 4,
  },
  {
    id: 'h2',
    goalId: 'g-self-short',
    title: 'Run',
    kind: 'habit',
    recurrence: 'custom',
    customInterval: 1,
    customUnit: 'weeks',
    doneToday: false,
  },
  {
    id: 'h3',
    goalId: 'g-self-short-2',
    title: 'Morning sit, 10 min',
    kind: 'habit',
    recurrence: 'daily',
    doneToday: false,
  },
  {
    id: 'h4',
    goalId: 'g-career-short',
    title: 'Write the launch post',
    kind: 'task',
    dueDate: '2026-09-15',
    dueTime: '09:00',
    doneToday: true,
    completed: true,
    completedAt: new Date('2026-05-18').getTime(),
  },
  {
    id: 'h5',
    goalId: 'g-comm-short',
    title: 'Phone away after 7pm',
    kind: 'habit',
    recurrence: 'daily',
    doneToday: true,
    completedAt: new Date('2026-05-20').getTime(),
    streak: 7,
  },
  {
    id: 'h6',
    goalId: 'g-comm-long',
    title: 'Call TD Insurance',
    kind: 'task',
    doneToday: false,
    completed: false,
  },
];

export interface ReflectionEntry {
  weekNumber: number;
  date: number;
  scores: Record<string, number>;
  note: string;
}

let seq = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/* ---- ported from goal-alignment-app/src/components/DomainGoalsStep.jsx ---- */

export function getParsedDate(dStr?: string): Date {
  if (!dStr) return new Date();
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Habit recurrence label, with a "Starts in N days" prefix when start is future. */
export function getRecurrenceString(h: Habit): string {
  const anchor = getParsedDate(h.startDate);
  const dayName = DAY_NAMES[anchor.getDay()];
  const dateNum = anchor.getDate();
  const monthName = MONTH_NAMES[anchor.getMonth()];
  const rec = h.recurrence ?? 'daily';

  let recStr: string;
  switch (rec) {
    case 'daily':
      recStr = 'Repeats Daily';
      break;
    case 'weekdays':
      recStr = 'Repeats Mon–Fri';
      break;
    case 'weekly':
      recStr = `Repeats Weekly on ${dayName}`;
      break;
    case 'monthly':
      recStr = `Repeats Monthly on day ${dateNum}`;
      break;
    case 'yearly':
      recStr = `Repeats Annually on ${monthName} ${dateNum}`;
      break;
    case 'custom': {
      const unit = h.customUnit ?? 'weeks';
      const iv = h.customInterval && h.customInterval > 1 ? h.customInterval : 1;
      recStr =
        iv === 1
          ? `Repeats every ${unit.slice(0, -1)}`
          : `Repeats every ${iv} ${unit}`;
      break;
    }
    case 'specific-days': {
      const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = (h.specificDays ?? []).slice().sort((a, b) => a - b);
      recStr = days.length
        ? `Repeats ${days.map((d) => SHORT[d]).join(', ')}`
        : 'Repeats (no days set)';
      break;
    }
    default:
      recStr = 'Repeats Daily';
  }

  if (h.startDate) {
    const start = getParsedDate(h.startDate);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start > today) {
      const dLeft = Math.ceil((start.getTime() - today.getTime()) / 86_400_000);
      return `Starts in ${dLeft} day${dLeft > 1 ? 's' : ''} • ${recStr}`;
    }
  }
  return recStr;
}

/** Long: createdAt + timeframe years. Short: createdAt + timeframe months. */
export function getGoalCountdown(goal: Goal): string {
  if (goal.horizon === 'ongoing') return 'Ongoing';
  const created = new Date(goal.createdAt || Date.now());
  const target = new Date(created);
  if (goal.horizon === 'long') {
    target.setFullYear(target.getFullYear() + (goal.timeframe || 1));
  } else {
    target.setMonth(target.getMonth() + (goal.timeframe || 1));
  }

  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'Time window expired';

  const daysLeft = Math.floor(diffMs / 86_400_000);
  const monthsLeft = Math.floor(daysLeft / 30);
  const remDays = daysLeft % 30;
  if (monthsLeft > 0) return `${monthsLeft} mo, ${remDays} d left`;
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

/** One-off task: "Jun 15, 14:30 · 27 d left". */
export function getTaskCountdown(task: Habit): string {
  if (!task.dueDate) return 'No date set';
  const d = getParsedDate(task.dueDate);
  const dateLabel = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  const timeStr = task.dueTime ? `, ${task.dueTime}` : '';
  const target = getParsedDate(task.dueDate);
  target.setHours(23, 59, 59, 999);
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return `${dateLabel}${timeStr} · overdue`;
  const dLeft = Math.floor(diff / 86_400_000);
  const rel = dLeft === 0 ? 'due today' : `${dLeft} d left`;
  return `${dateLabel}${timeStr} · ${rel}`;
}
