import type { Domain, Goal, Habit } from './data';

export interface FocusPick {
  id: string;
  reason: string;
}

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

function cacheKey(date: string) {
  return `gemini-focus-v2-${date}`;
}

function isoWeek(d: Date): number {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const jan4 = new Date(t.getFullYear(), 0, 4);
  const diff = t.getTime() - jan4.getTime();
  return 1 + Math.round((diff / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
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
  const allValues = domains.flatMap((d) => d.values);
  const weekValue = allValues.length ? allValues[isoWeek(now) % allValues.length] : null;

  const actionableSet = new Set(actionableIds);
  const actionable = habits.filter((h) => actionableSet.has(h.id));

  const goalMap = new Map(goals.map((g) => [g.id, g]));

  const contextLines: string[] = [
    `Today is ${dayName}, ${today}.`,
    weekValue ? `This week's focus theme: "${weekValue}".` : '',
    '',
    '## Domains, values, and visions',
    ...domains.map((d) =>
      `- ${d.name}: values=[${d.values.join(', ')}] | vision="${d.vision}"`
    ),
    '',
    '## Goals (id | title | horizon | timeframe | values)',
    ...goals
      .filter((g) => !g.completedAt)
      .map((g) => {
        const dom = domains.find((d) => d.id === g.domainId)!;
        const vals = g.valueIndexes.map((i) => dom.values[i]).join(', ');
        return `- ${g.id} | "${g.title}" | ${g.horizon} | ${g.timeframe}${g.horizon === 'long' ? 'yr' : 'mo'} | [${vals}]`;
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
