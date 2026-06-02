import type { Domain, Goal, Habit, ReflectionEntry } from './data';
import { supabase, localMode } from './supabase';

export interface FocusPick {
  id: string;
  reason: string;
}

export interface CoachCard {
  title: string;
  blurb: string;
}

export interface CoachFeedback {
  date: string;
  title: string;
  rating: 'up' | 'down';
}

const FEEDBACK_KEY = 'gemini-coach-feedback-v2';

export async function saveCoachFeedback(
  date: string,
  title: string,
  rating: 'up' | 'down',
  userId?: string,
): Promise<void> {
  if (!localMode && userId) {
    await supabase
      .from('coach_feedback')
      .upsert({ user_id: userId, date, title, rating }, { onConflict: 'user_id,date' });
  } else {
    const history = getLocalFeedbackHistory().filter((f) => f.date !== date);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify([...history, { date, title, rating }].slice(-30)));
  }
}

export async function getCoachFeedbackHistory(userId?: string): Promise<CoachFeedback[]> {
  if (!localMode && userId) {
    const { data } = await supabase
      .from('coach_feedback')
      .select('date, title, rating')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(30);
    return (data ?? []) as CoachFeedback[];
  }
  return getLocalFeedbackHistory();
}

export async function getTodayCoachRating(
  date: string,
  title: string,
  userId?: string,
): Promise<'up' | 'down' | null> {
  if (!localMode && userId) {
    const { data } = await supabase
      .from('coach_feedback')
      .select('rating')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();
    return (data?.rating as 'up' | 'down' | null) ?? null;
  }
  return getLocalFeedbackHistory().find((f) => f.date === date && f.title === title)?.rating ?? null;
}

function getLocalFeedbackHistory(): CoachFeedback[] {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '[]') as CoachFeedback[]; }
  catch { return []; }
}

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

function cacheKey(date: string) {
  return `gemini-focus-v3-${date}`;
}

/**
 * Returns the value most starved of recent habit activity — the value
 * whose associated goals have the lowest average habit completions in the
 * last 14 days. Mirrors the logic used to surface neglected goals so the
 * weekly nudge is always grounded in real behaviour gaps.
 */
function neglectedValue(domains: Domain[], goals: Goal[], habits: Habit[]): string | null {
  const activeGoals = goals.filter((g) => !g.completedAt);
  // score[domainId:valueName] = { completions, habitCount }
  const score = new Map<string, { completions: number; habitCount: number }>();

  domains.forEach((d) => {
    d.values.forEach((v) => {
      const tagged = activeGoals.filter(
        (g) => g.domainId === d.id && g.valueIndexes.some((i) => d.values[i] === v),
      );
      tagged.forEach((g) => {
        habits
          .filter((h) => h.goalId === g.id && h.kind === 'habit' && !h.completed)
          .forEach((h) => {
            const recent = (h.completions ?? []).filter((dateStr) => {
              return (Date.now() - new Date(dateStr + 'T12:00').getTime()) / 86_400_000 <= 14;
            }).length;
            const key = `${d.id}:${v}`;
            const cur = score.get(key) ?? { completions: 0, habitCount: 0 };
            score.set(key, { completions: cur.completions + recent, habitCount: cur.habitCount + 1 });
          });
      });
    });
  });

  // Pick the value with the fewest recent completions relative to its habits
  let worstKey: string | null = null;
  let worstRate = Infinity;
  for (const [key, { completions, habitCount }] of score) {
    if (habitCount === 0) continue;
    const rate = completions / habitCount;
    if (rate < worstRate) { worstRate = rate; worstKey = key; }
  }

  if (!worstKey) {
    // No habits linked to any value — fall back to the first value overall
    const all = domains.flatMap((d) => d.values);
    return all.length ? all[0] : null;
  }
  return worstKey.slice(worstKey.indexOf(':') + 1);
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysSince(completions: string[]): number | null {
  if (!completions.length) return null;
  const last = completions.reduce(
    (max, d) => Math.max(max, new Date(d + 'T12:00').getTime()), 0,
  );
  return Math.floor((Date.now() - last) / 86_400_000);
}

export async function getGeminiFocusPicks(
  domains: Domain[],
  goals: Goal[],
  habits: Habit[],
  actionableIds: string[],
): Promise<FocusPick[]> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) throw new Error('No VITE_GEMINI_API_KEY');

  const today = toDateStr(new Date());
  const cached = localStorage.getItem(cacheKey(today));
  if (cached) {
    try { return JSON.parse(cached) as FocusPick[]; } catch { /* fall through */ }
  }

  const now = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const weekValue = neglectedValue(domains, goals, habits);

  const actionableSet = new Set(actionableIds);
  const actionable = habits.filter((h) => actionableSet.has(h.id));

  const goalMap = new Map(goals.map((g) => [g.id, g]));

  // Maps "domainId:valueIndex" -> "DomainName/ValueName" for current values only
  const valueLookup = new Map<string, string>();
  domains.forEach((d) => d.values.forEach((v) => valueLookup.set(`${d.id}:${v}`, `${d.name}/${v}`)));

  const resolveGoalValues = (g: Goal): string => {
    const dom = domains.find((d) => d.id === g.domainId);
    if (!dom) return '';
    return g.valueIndexes
      .filter((i) => i < dom.values.length)
      .map((i) => dom.values[i])
      .join(', ');
  };

  // First active goal per domain = the one the user has dragged to the top = in focus
  const focusGoalIds = new Set<string>();
  const seenDomains = new Set<string>();
  for (const g of goals) {
    if (!g.completedAt && !seenDomains.has(g.domainId)) {
      focusGoalIds.add(g.id);
      seenDomains.add(g.domainId);
    }
  }

  const contextLines: string[] = [
    `Today is ${dayName}, ${today}.`,
    weekValue ? `Most neglected value right now (fewest recent habit completions): "${weekValue}". Favour items that serve this value.` : '',
    '',
    '## Domains, values, and visions',
    ...domains.map((d) =>
      `- ${d.name}: values=[${d.values.join(', ')}] | vision="${d.vision}"`
    ),
    '',
    '## Goals (id | title | horizon | timeframe | values | focus)',
    ...goals
      .filter((g) => !g.completedAt)
      .map((g) => {
        const vals = resolveGoalValues(g);
        const focus = focusGoalIds.has(g.id) ? ' | IN FOCUS' : '';
        return `- ${g.id} | "${g.title}" | ${g.horizon} | ${g.timeframe}${g.horizon === 'long' ? 'yr' : 'mo'} | [${vals}]${focus}`;
      }),
    '',
    '## Actionable items today (id | kind | title | goal | recurrence/due | streak | days since last done)',
    ...actionable.map((h) => {
      const g = goalMap.get(h.goalId);
      const goalTitle = g?.title ?? '?';
      const cadence = h.kind === 'task'
        ? `due:${h.dueDate ?? 'none'}`
        : (h.recurrence ?? 'daily');
      const streak = h.streak ?? 0;
      const since = h.kind === 'habit' ? daysSince(h.completions ?? []) : null;
      return `- ${h.id} | ${h.kind} | "${h.title}" | goal:"${goalTitle}" | ${cadence} | streak:${streak} | last:${since == null ? 'never' : `${since}d ago`}`;
    }),
  ].filter((l) => l !== undefined);

  const prompt = `You are the focus advisor for a personal alignment app. Your job is to pick up to 3 habits AND up to 3 tasks for the user to focus on TODAY (6 items maximum total).

Selection criteria (weigh all of these):
1. Alignment with this week's theme value ("${weekValue ?? 'none'}") and the user's deeper values/vision.
2. Urgency: overdue or due-today tasks, neglected habits.
3. Balance: try not to pick all items from the same domain unless there are no alternatives.
4. Momentum: protecting an active streak matters.
5. Short-term goals are the active push; long-term goal items need periodic attention to avoid neglect.
6. Focus: if any goal is marked "IN FOCUS", strongly favor items tied to that goal — the user has declared it their top commitment right now.
7. Neglected value: items that serve the most neglected value (listed above) should be favoured to rebalance attention.

Pick up to 3 habits (kind=habit) and up to 3 tasks (kind=task) separately — if fewer than 3 of a kind exist, include all of them.
For each pick, write a reason that is: 5–10 words, specific (reference the goal or value), and motivating.

${contextLines.join('\n')}

Return JSON only — an array of up to 6 objects: [{"id":"...", "reason":"..."}, ...]
Only use IDs from the actionable items list above.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            reason: { type: 'STRING' },
          },
          required: ['id', 'reason'],
        },
        minItems: 1,
        maxItems: 6,
      },
      temperature: 0.4,
    },
  };

  const res = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const picks = JSON.parse(text) as FocusPick[];

  localStorage.setItem(cacheKey(today), JSON.stringify(picks));
  return picks;
}

function valueFingerprint(domains: Domain[]): string {
  const joined = domains.flatMap((d) => d.values).join('|');
  let h = 0;
  for (let i = 0; i < joined.length; i++) {
    h = (h * 31 + joined.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h).toString(36);
}

function isoWeek(d: Date): number {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const jan4 = new Date(t.getFullYear(), 0, 4);
  const diff = t.getTime() - jan4.getTime();
  return 1 + Math.round((diff / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

function coachCacheKey(date: string, domains: Domain[]) {
  return `gemini-coach-v14-${date}-${valueFingerprint(domains)}`;
}

export async function getGeminiCoachCard(
  domains: Domain[],
  goals: Goal[],
  habits: Habit[],
  reflections: ReflectionEntry[],
  userId?: string,
): Promise<CoachCard> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) throw new Error('No VITE_GEMINI_API_KEY');

  const today = toDateStr(new Date());
  const cached = localStorage.getItem(coachCacheKey(today, domains));
  if (cached) {
    try { return JSON.parse(cached) as CoachCard; } catch { /* fall through */ }
  }

  const now = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const allValues = domains.flatMap((d) => d.values);
  const weekValue = allValues.length ? allValues[isoWeek(now) % allValues.length] : null;

  const goalMap = new Map(goals.map((g) => [g.id, g]));

  const valueLookup = new Map<string, string>();
  domains.forEach((d) => d.values.forEach((v) => valueLookup.set(`${d.id}:${v}`, `${d.name}/${v}`)));

  const resolveGoalValues = (g: Goal): string => {
    const dom = domains.find((d) => d.id === g.domainId);
    if (!dom) return '';
    return g.valueIndexes
      .filter((i) => i < dom.values.length)
      .map((i) => dom.values[i])
      .join(', ');
  };

  // First active goal per domain = top priority (user's drag order)
  const topGoalIds = new Set<string>();
  const seenDomains = new Set<string>();
  for (const g of goals) {
    if (!g.completedAt && !seenDomains.has(g.domainId)) {
      topGoalIds.add(g.id);
      seenDomains.add(g.domainId);
    }
  }

  const activeGoals = goals.filter((g) => !g.completedAt);
  const ltGoals = activeGoals.filter((g) => g.horizon === 'long');
  const stGoals = activeGoals.filter((g) => g.horizon === 'short');

  const goalLine = (g: Goal) => {
    const dom = domains.find((d) => d.id === g.domainId);
    const vals = resolveGoalValues(g);
    const priority = topGoalIds.has(g.id) ? ' [TOP PRIORITY]' : '';
    return `- "${g.title}" | ${g.timeframe}${g.horizon === 'long' ? 'yr' : 'mo'} | ${dom?.name ?? '?'}${vals ? ` | values:[${vals}]` : ''}${priority}`;
  };

  const contextLines: string[] = [
    `Today is ${dayName}, ${today}.`,
    weekValue ? `This week's value thread: "${weekValue}".` : '',
    '',
    '## Long-term goals',
    ...(ltGoals.length ? ltGoals.map(goalLine) : ['- (none)']),
    '',
    '## Short-term goals',
    ...(stGoals.length ? stGoals.map(goalLine) : ['- (none)']),
    '',
    '## Habits & tasks (title | goal | cadence | streak | recent completions)',
    ...habits.map((h) => {
      const g = goalMap.get(h.goalId);
      const goalTitle = g?.title ?? '?';
      if (h.kind === 'task') {
        const status = h.completed ? `done` : `due:${h.dueDate ?? 'none'}`;
        return `- "${h.title}" | goal:"${goalTitle}" | task | ${status}`;
      }
      const streak = h.streak ?? 0;
      const recent = (h.completions ?? []).slice(-7).join(', ') || 'none';
      return `- "${h.title}" | goal:"${goalTitle}" | ${h.recurrence ?? 'daily'} | streak:${streak} | recent:[${recent}]`;
    }),
    '',
    '## Weekly reflections (most recent first)',
    ...(reflections.length > 0
      ? reflections.slice(-4).reverse().map((r) => {
          const scores = Object.entries(r.scores)
            .filter(([k]) => valueLookup.has(k))
            .map(([k, v]) => `${valueLookup.get(k)}:${v}`)
            .join(', ');
          return `- week ${r.weekNumber} | [${scores || 'no scores'}] | "${r.note}"`;
        })
      : ['- (none yet)']),
  ];

  const feedback = (await getCoachFeedbackHistory(userId)).slice(-20);
  const liked = feedback.filter((f) => f.rating === 'up').map((f) => `"${f.title}"`).join(', ');
  const disliked = feedback.filter((f) => f.rating === 'down').map((f) => `"${f.title}"`).join(', ');
  const feedbackLines = (liked || disliked)
    ? `\n## Style feedback on past cards\n- Liked: ${liked || 'none'}\n- Disliked: ${disliked || 'none'}\nMatch the style of liked cards; avoid the tone of disliked ones.\n`
    : '';

  const prompt = `You are a direct personal coach. Write one daily coaching card grounded in the user's goals.

Approach:
- Lead with the user's most important active goal(s). TOP PRIORITY goals (first in their list per domain) carry the most weight.
- Reference both a long-term goal (the deeper "why") and a short-term goal or habit (the concrete "what now") where possible.
- The weekly value thread is context — let it colour the message naturally, not dominate it.
- Only reference goals, habits, and values that appear verbatim in the data below.
- Tone: warm, direct, brief. No filler.

Format:
- Title: 4–6 words, grounded in a real goal or habit.
- Blurb: exactly 2 sentences. First: encouragement tied to a specific goal, habit, or recent progress. Second: one concrete nudge for today.
${feedbackLines}
${contextLines.join('\n')}

Return JSON only: {"title": "...", "blurb": "..."}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          blurb: { type: 'STRING' },
        },
        required: ['title', 'blurb'],
      },
      temperature: 0.7,
    },
  };

  const res = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const card = JSON.parse(text) as CoachCard;

  localStorage.setItem(coachCacheKey(today, domains), JSON.stringify(card));
  return card;
}
