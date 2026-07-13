export type DomainId = 'career' | 'self' | 'community';

export interface Domain {
  id: DomainId;
  name: string;
  blurb: string;
  values: string[];
  vision: string;
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
  /** habit only: consecutive periods completed in a row */
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
    id: 'career',
    name: 'Career',
    blurb: 'The work you put into the world.',
    values: ['Leadership', 'Autonomy', 'Flexibility', 'Professional Respect', 'Competence', 'Service'],
    vision:
      'To build a respected and flexible career in film and media where I have the autonomy to teach, create meaningful work, and positively contribute to others.',
  },
  {
    id: 'self',
    name: 'Self',
    blurb: 'Your mind, body, and inner life.',
    values: ['Physical Health', 'Growth', 'Maturity', 'Balance', 'Joy', 'Challenges'],
    vision:
      'To become physically healthy, emotionally steady, and genuinely at ease — growing continuously without burning out.',
  },
  {
    id: 'community',
    name: 'Family/Others',
    blurb: 'The people you belong to.',
    values: ['Leadership', 'Financial Security', 'Presence', 'Integrity', 'Love', 'Community'],
    vision:
      'To be a present, loving husband and father who leads his family with integrity, warmth, and a long view — creating a stable, generous home deeply connected to community.',
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
    domainId: 'community',
    valueIndexes: [0],
    horizon: 'long',
    title: 'No regrets about time with the people I love',
    createdAt: d('2025-05-20'),   // ~1 yr ago, 5-yr window → ~20% elapsed
    timeframe: 5,
  },
  {
    id: 'g-comm-short',
    domainId: 'community',
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
