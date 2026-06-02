import type { Domain, Goal, Habit, ReflectionEntry } from './data';

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

const FEEDBACK_KEY = 'gemini-coach-feedback';

export function saveCoachFeedback(date: string, title: string, rating: 'up' | 'down' | null): void {
  const history = getCoachFeedbackHistory().filter((f) => f.date !== date);
  const updated = rating ? [...history, { date, title, rating }].slice(-30) : history;
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated));
}

export function getCoachFeedbackHistory(): CoachFeedback[] {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '[]') as CoachFeedback[]; }
  catch { return []; }
}

export function getTodayCoachRating(date: string, title: string): 'up' | 'down' | null {
  return getCoachFeedbackHistory().find((f) => f.date === date && f.title === title)?.rating ?? null;
}

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

function cacheKey(date: string) {
  return `gemini-focus-v2-${date}`;
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

  const prompt = `You are the focus advisor for a personal alignment app. Your job is to pick the 3 most important items for the user to do TODAY.

Selection criteria (weigh all of these):
1. Alignment with this week's theme value ("${weekValue ?? 'none'}") and the user's deeper values/vision.
2. Urgency: overdue or due-today tasks, neglected habits.
3. Balance: try not to pick 3 items from the same domain unless there are no alternatives.
4. Momentum: protecting an active streak matters.
5. Short-term goals are the active push; long-term goal items need periodic attention to avoid neglect.
6. Focus: if any goal is marked "IN FOCUS", strongly favor items tied to that goal — the user has declared it their top commitment right now.
7. Neglected value: items that serve the most neglected value (listed above) should be favoured to rebalance attention.

For each pick, write a reason that is: 5–10 words, specific (reference the goal or value), and motivating.

${contextLines.join('\n')}

Return JSON only — an array of exactly 3 objects: [{"id":"...", "reason":"..."}, ...]
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
        maxItems: 3,
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

function coachCacheKey(date: string, domains: Domain[]) {
  return `gemini-coach-v9-${date}-${valueFingerprint(domains)}`;
}

export async function getGeminiCoachCard(
  domains: Domain[],
  goals: Goal[],
  habits: Habit[],
  reflections: ReflectionEntry[],
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
  const weekValue = neglectedValue(domains, goals, habits);

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

  // First active goal per domain (array order = user's drag order) = in focus
  const coachFocusIds = new Set<string>();
  const coachSeenDomains = new Set<string>();
  for (const g of goals) {
    if (!g.completedAt && !coachSeenDomains.has(g.domainId)) {
      coachFocusIds.add(g.id);
      coachSeenDomains.add(g.domainId);
    }
  }

  const contextLines: string[] = [
    `Today is ${dayName}, ${today}.`,
    weekValue ? `Most neglected value right now (fewest recent habit completions): "${weekValue}". Consider addressing this gap.` : '',
    '',
    '## Domains, values, and life visions',
    ...domains.map((d) =>
      `- ${d.name}: values=[${d.values.join(', ')}] | vision="${d.vision}"`
    ),
    '',
    '## All goals (id | title | horizon | timeframe | domain | values | focus | status)',
    ...goals.map((g) => {
      const dom = domains.find((d) => d.id === g.domainId);
      const vals = resolveGoalValues(g);
      const status = g.completedAt ? 'completed' : 'active';
      const focus = coachFocusIds.has(g.id) ? 'IN FOCUS' : '-';
      return `- ${g.id} | "${g.title}" | ${g.horizon} | ${g.timeframe}${g.horizon === 'long' ? 'yr' : 'mo'} | ${dom?.name ?? '?'} | [${vals}] | ${focus} | ${status}`;
    }),
    '',
    '## All habits & tasks (id | kind | title | goal | recurrence/due | streak | completion history)',
    ...habits.map((h) => {
      const g = goalMap.get(h.goalId);
      const goalTitle = g?.title ?? '?';
      if (h.kind === 'task') {
        const status = h.completed ? `completed ${h.completedAt ? toDateStr(new Date(h.completedAt)) : '?'}` : `open, due:${h.dueDate ?? 'none'}`;
        return `- ${h.id} | task | "${h.title}" | goal:"${goalTitle}" | ${status}`;
      }
      const cadence = h.recurrence ?? 'daily';
      const streak = h.streak ?? 0;
      const recent = (h.completions ?? []).slice(-14).join(', ') || 'none';
      return `- ${h.id} | habit | "${h.title}" | goal:"${goalTitle}" | ${cadence} | streak:${streak} | recent completions:[${recent}]`;
    }),
    '',
    '## Weekly reflections (week | date | value scores | note)',
    ...(reflections.length > 0
      ? reflections.slice(-8).map((r) => {
          const scores = Object.entries(r.scores)
            .filter(([k]) => valueLookup.has(k))
            .map(([k, v]) => `${valueLookup.get(k)}:${v}`)
            .join(', ');
          return `- week ${r.weekNumber} | ${toDateStr(new Date(r.date))} | [${scores || 'no current values scored'}] | "${r.note}"`;
        })
      : ['- (no reflections yet)']),
  ];

  const feedback = getCoachFeedbackHistory().slice(-20);
  const liked = feedback.filter((f) => f.rating === 'up').map((f) => `"${f.title}"`).join(', ');
  const disliked = feedback.filter((f) => f.rating === 'down').map((f) => `"${f.title}"`).join(', ');
  const feedbackLines = (liked || disliked)
    ? `\n## Style feedback from user on past cards\nUse this ONLY to shape writing style, tone, and format — NOT to change which value, goal, or habit you spotlight (that is always determined by the user's real data above).\n- Liked (write in a similar style): ${liked || 'none'}\n- Disliked (avoid this style/tone): ${disliked || 'none'}\n`
    : '';

  const validValues = domains.flatMap((d) => d.values);
  const validGoals = goals.filter((g) => !g.completedAt).map((g) => `"${g.title}"`).join(', ');
  const validHabits = habits.map((h) => `"${h.title}"`).join(', ');

  const prompt = `You are a direct personal coach. Write a daily coaching card based ONLY on the user's real data below.

When the user has a goal marked "IN FOCUS", anchor your coaching card to that goal — it is what they have declared their top commitment right now.

CRITICAL — anti-fabrication rules:
- The ONLY value names that exist are: [${validValues.join(', ')}].
- The ONLY goals that exist are: [${validGoals || 'none'}].
- The ONLY habits/tasks that exist are: [${validHabits || 'none'}].
- You MUST NOT mention, quote, or reference any value, goal, habit, or streak that is not in those exact lists. If you are about to write a name, verify it appears verbatim above. Inventing names like "Craft over speed" or "Calm attention" is strictly forbidden.
- If you have nothing specific and real to praise, give general encouragement without naming a fake item.

Format:
- Title: 4–6 words max. Do not put a value/habit name in quotes unless it is one of the real ones above.
- Blurb: exactly 2 sentences. First: one specific encouragement grounded in real data. Second: one concrete, real action or nudge.
- Tone: warm but brief. No filler.
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
      temperature: 0.25,
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
