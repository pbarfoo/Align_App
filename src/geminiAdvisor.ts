import type { Domain, Goal, Habit, ReflectionEntry } from './data';
import { supabase } from './supabase';

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

export async function saveCoachFeedback(
  date: string,
  title: string,
  rating: 'up' | 'down',
  userId?: string,
): Promise<void> {
  if (!userId) return;
  await supabase
    .from('coach_feedback')
    .upsert({ user_id: userId, date, title, rating }, { onConflict: 'user_id,date' });
}

export async function getCoachFeedbackHistory(userId?: string): Promise<CoachFeedback[]> {
  if (!userId) return [];
  const { data } = await supabase
    .from('coach_feedback')
    .select('date, title, rating')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(30);
  return (data ?? []) as CoachFeedback[];
}

export async function getTodayCoachRating(
  date: string,
  _title: string,
  userId?: string,
): Promise<'up' | 'down' | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from('coach_feedback')
    .select('rating')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
  return (data?.rating as 'up' | 'down' | null) ?? null;
}

type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

async function callGemini(body: unknown): Promise<GeminiResponse> {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', { body: { body } });
  if (error) throw new Error(error.message);
  return data as GeminiResponse;
}

/**
 * Server-computed coach grounding data (get_coach_context RPC, security
 * invoker — scoped to the signed-in user): goal_health worst-first,
 * recent_reflections, overdue_tasks, habits with 14-day completion counts,
 * and recent_coach_ratings. Returns null on any failure so the coach can
 * fall back to the ungrounded prompt.
 */
async function getCoachContext(): Promise<unknown | null> {
  try {
    const { data, error } = await supabase.rpc('get_coach_context');
    if (error) {
      console.warn('get_coach_context failed, coach runs ungrounded:', error.message);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn('get_coach_context threw, coach runs ungrounded:', err);
    return null;
  }
}

function cacheKey(date: string) {
  return `gemini-focus-v6-${date}`;
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

/** The unit one "streak" step represents, so the coach can say "4 days in a
 * row" instead of a meaningless bare "streak is 4". */
function streakUnit(h: Habit): string {
  switch (h.recurrence) {
    case 'daily': return 'day';
    case 'weekdays': return 'weekday';
    case 'weekly': return 'week';
    case 'monthly': return 'month';
    case 'yearly': return 'year';
    case 'custom': return (h.customUnit ?? 'week').replace(/s$/, '');
    case 'specific-days': return 'session';
    default: return 'time';
  }
}

/** Human-readable streak phrase for the coach prompt, e.g. "4 days in a row". */
function streakPhrase(h: Habit): string {
  const n = h.streak ?? 0;
  if (n <= 0) return 'no active streak';
  const unit = streakUnit(h);
  return `${n} ${unit}${n === 1 ? '' : 's'} in a row`;
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
  /** App-computed scores so picks are grounded in what the user sees:
   * goal title → health 0–100, and "Domain/Value" → alignment 0–100. */
  extras?: { appGoalHealth?: Record<string, number>; valueAlignment?: Record<string, number> },
  bust = false,
): Promise<FocusPick[]> {

  const today = toDateStr(new Date());
  if (!bust) {
    const cached = localStorage.getItem(cacheKey(today));
    if (cached) {
      try { return JSON.parse(cached) as FocusPick[]; } catch { /* fall through */ }
    }
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
    ...(extras?.appGoalHealth ? [
      '',
      '## Goal health (0–100, exactly what the user sees; LOW = needs rescue)',
      ...Object.entries(extras.appGoalHealth).map(([t, h]) => `- "${t}": ${h}`),
    ] : []),
    ...(extras?.valueAlignment ? [
      '',
      '## Value alignment (0–100; LOW = this value is being neglected lately)',
      ...Object.entries(extras.valueAlignment).map(([v, s]) => `- ${v}: ${s}`),
    ] : []),
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

  const prompt = `You are the focus advisor for a personal alignment app. Your job is to pick the 2 or 3 TASKS that matter MOST today (3 maximum total). Fewer, better picks beat coverage.

Selection criteria (weigh all of these):
1. Alignment with this week's theme value ("${weekValue ?? 'none'}") and the user's deeper values/vision.
2. Urgency: overdue or due-today tasks, neglected habits.
3. Balance: try not to pick all items from the same domain unless there are no alternatives.
4. Momentum: protecting an active streak matters.
5. Short-term goals are the active push; long-term goal items need periodic attention to avoid neglect.
6. Focus: if any goal is marked "IN FOCUS", strongly favor items tied to that goal — the user has declared it their top commitment right now.
7. Neglected value: items that serve the most neglected value (listed above) should be favoured to rebalance attention.
8. Rescue: prefer items that lift LOW goal-health scores and LOW value-alignment scores — that is the whole point of a focus pick. Mention the score or the value in the reason when it drove the choice.

For each pick, write a reason that is: 5–10 words, specific (reference the goal or value), and motivating.

${contextLines.join('\n')}

Return JSON only — an array of 2 or 3 task picks: [{"id":"...", "reason":"..."}, ...]
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

  const data = await callGemini(body);
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


function coachCacheKey(date: string, domains: Domain[], focusId?: string) {
  // The sprint-focus goal steers the card, so it's part of the cache identity:
  // switch focus and you get a fresh card oriented to the new goal that day.
  const focusPart = focusId ? `-sf:${focusId}` : '';
  return `gemini-coach-v31-${date}-${valueFingerprint(domains)}${focusPart}`;
}

function yesterdayCardTitle(domains: Domain[]): string | null {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = toDateStr(yesterday);
  // Check recent key versions so we catch whatever ran yesterday
  for (const v of ['v31', 'v30', 'v29', 'v28', 'v27', 'v26', 'v25', 'v24', 'v23', 'v22', 'v21', 'v20']) {
    const raw = localStorage.getItem(`gemini-coach-${v}-${yStr}-${valueFingerprint(domains)}`);
    if (raw) {
      try { return (JSON.parse(raw) as CoachCard).title; } catch { /* skip */ }
    }
  }
  return null;
}

export async function getGeminiCoachCard(
  domains: Domain[],
  goals: Goal[],
  habits: Habit[],
  reflections: ReflectionEntry[],
  userId?: string,
  /** title → health 0–100 as shown on the goal cards; overrides the server
   * view's numbers so the coach always quotes what the user actually sees. */
  appGoalHealth?: Record<string, number>,
): Promise<CoachCard> {

  const today = toDateStr(new Date());
  // The single sprint focus (chosen in Align) — the goal the user is centring
  // this stretch of work on. It steers the card and is part of the cache key.
  const sprintFocusGoal = goals.find((g) => g.sprintFocusAt && !g.completedAt);
  const cached = localStorage.getItem(coachCacheKey(today, domains, sprintFocusGoal?.id));
  if (cached) {
    try { return JSON.parse(cached) as CoachCard; } catch { /* fall through */ }
  }

  // Fetch server-computed grounding data before every generation; null → the
  // prompt below simply omits the grounding block (ungrounded fallback).
  const coachCtx = await getCoachContext();

  // Unify health numbers: replace the view-computed goal_health scores with
  // the app's own (matched by title), then re-sort worst-first, so the coach
  // quotes exactly what the badges and dashboard show.
  if (coachCtx && appGoalHealth && typeof coachCtx === 'object') {
    const ctx = coachCtx as { goal_health?: Array<{ goal?: string; health?: number }> };
    if (Array.isArray(ctx.goal_health)) {
      ctx.goal_health = ctx.goal_health
        .map((row) => (row.goal != null && appGoalHealth[row.goal] != null
          ? { ...row, health: appGoalHealth[row.goal] }
          : row))
        .sort((a, b) => (a.health ?? 0) - (b.health ?? 0));
    }
  }

  const now = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];

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

  // First active goal per domain = focus (user's drag order)
  const topGoalIds = new Set<string>();
  const seenDomains = new Set<string>();
  for (const g of goals) {
    if (!g.completedAt && !seenDomains.has(g.domainId)) {
      topGoalIds.add(g.id);
      seenDomains.add(g.domainId);
    }
  }

  // Values from focus goals (what the user has declared most important per domain)
  const focusValues = Array.from(topGoalIds).flatMap((id) => {
    const g = goals.find((goal) => goal.id === id);
    if (!g) return [];
    const dom = domains.find((d) => d.id === g.domainId);
    if (!dom) return [];
    return g.valueIndexes.filter((i) => i < dom.values.length).map((i) => dom.values[i]);
  });

  // Values with low average reflection scores. Scores are 0–3
  // (Drifted/Some/Mostly/Aligned); below 1.5 means mostly drifting.
  const scoreAccum = new Map<string, number[]>();
  reflections.slice(-4).forEach((r) => {
    Object.entries(r.scores).forEach(([key, val]) => {
      if (!scoreAccum.has(key)) scoreAccum.set(key, []);
      scoreAccum.get(key)!.push(val as number);
    });
  });
  const lowScoringValues = Array.from(scoreAccum.entries())
    .map(([key, vals]) => ({ name: key.slice(key.indexOf(':') + 1), avg: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .filter((v) => v.avg < 1.5)
    .sort((a, b) => a.avg - b.avg)
    .map((v) => v.name);

  const activeGoals = goals.filter((g) => !g.completedAt);
  const ltGoals = activeGoals.filter((g) => g.horizon === 'long');
  const stGoals = activeGoals.filter((g) => g.horizon === 'short');

  const goalLine = (g: Goal) => {
    const dom = domains.find((d) => d.id === g.domainId);
    const vals = resolveGoalValues(g);
    const priority = topGoalIds.has(g.id) ? ' [FOCUS]' : '';
    const sprint = sprintFocusGoal && g.id === sprintFocusGoal.id ? ' [SPRINT FOCUS]' : '';
    return `- "${g.title}" | ${g.timeframe}${g.horizon === 'long' ? 'yr' : 'mo'} | ${dom?.name ?? '?'}${vals ? ` | values:[${vals}]` : ''}${priority}${sprint}`;
  };

  const contextLines: string[] = [
    `Today is ${dayName}, ${today}.`,
    focusValues.length ? `Values tied to focus goals: ${focusValues.join(', ')}.` : '',
    lowScoringValues.length ? `Values with recent low reflection scores (needs attention): ${lowScoringValues.join(', ')}.` : '',
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
        const status = h.completed ? `DONE (already completed)` : `due:${h.dueDate ?? 'none'}`;
        return `- "${h.title}" | goal:"${goalTitle}" | task | ${status}`;
      }
      const recent = (h.completions ?? []).slice(-7).join(', ') || 'none';
      return `- "${h.title}" | goal:"${goalTitle}" | ${h.recurrence ?? 'daily'} | streak:${streakPhrase(h)} | recent:[${recent}]`;
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
  ].filter((l) => l !== '');

  const feedback = (await getCoachFeedbackHistory(userId)).slice(-20);
  const liked = feedback.filter((f) => f.rating === 'up').map((f) => `"${f.title}"`).join(', ');
  const disliked = feedback.filter((f) => f.rating === 'down').map((f) => `"${f.title}"`).join(', ');
  const feedbackLines = (liked || disliked)
    ? `\n## Style & tone feedback (adjust HOW you write, not WHAT you cover)\n- Liked tone/style: ${liked || 'none'}\n- Disliked tone/style: ${disliked || 'none'}\nThis feedback is about writing style only — do not let it cause you to repeat the same values or goals.\n`
    : '';

  // The sprint focus is the user's single declared priority right now, so the
  // card should lean into it day over day (varying the angle) rather than
  // rotating away from it. When a sprint focus is set we therefore suppress the
  // "must cover a different goal" rule — otherwise the two instructions fight.
  const sprintFocusRule = sprintFocusGoal
    ? `- The user has set "${sprintFocusGoal.title}" as their SPRINT FOCUS — the single goal they're centring this stretch of work on. Anchor today's card on this goal or a habit/task that serves it, UNLESS a genuinely more urgent overdue item demands attention. It's fine (expected, even) to return to this goal on consecutive days — vary the angle and the specific item you name, but keep the sprint front of mind.`
    : '';

  const prevTitle = yesterdayCardTitle(domains);
  const rotateRule = prevTitle && !sprintFocusGoal
    ? `- Yesterday's card was titled "${prevTitle}". Today MUST cover a DIFFERENT goal, habit, or domain.`
    : '';

  // Rotate primary domain focus by day-of-week so the card always feels fresh —
  // but only when there's no sprint focus; a sprint anchor overrides the rota so
  // the card doesn't get pulled toward a different domain than the sprint goal.
  const domainRota = domains[now.getDay() % domains.length];
  const focusDomainRule = domainRota && !sprintFocusGoal
    ? `- Today's card should primarily draw from the "${domainRota.name}" domain (but can mention others).`
    : '';

  // Server-computed grounding block; empty string when the RPC failed so the
  // rest of the prompt works exactly as before (ungrounded fallback).
  const groundingBlock = coachCtx
    ? `
## Live data snapshot (server-computed, authoritative)
${JSON.stringify(coachCtx)}

Ground all feedback in this data. Reference specific goals by name. Call out overdue tasks and habits whose completions_last_14d is far below expected. Goals with health 0 have no tasks/habits — suggest one concrete next action for each. Use recent_coach_ratings to calibrate tone: more 'down' ratings means be more concise and practical.
Reflection scores in this data are stored 0–3 (0=Drifted, 1=Some, 2=Mostly, 3=Aligned). NEVER surface the number OR the bare label — no "reflection score was Some", no "score of 1". Describe how the user has felt about the value in plain, natural words: 0 → "you've been drifting from {value}"; 1 → "you've felt only loosely connected to {value}"; 2 → "you've mostly honoured {value}"; 3 → "you've felt fully aligned with {value}".
Goal health is a 0–100 number; you may mention it, but phrase it like a person ("AI Expertise is in good shape, around 88%"), never "goal health was 88%".
`
    : '';

  const prompt = `You are a personal coach. Write one daily coaching card grounded in the user's real data below.

HARD RULES — violations mean the card is wrong:
- The title MUST contain the name of a real goal or habit from the data. Never a generic phrase.
- The first sentence MUST mention a specific habit name, streak count, goal title, or completion from the data.
- NEVER open with day-of-week phrases like "It's Monday", "Fresh week", "Start your week", "New week", etc.
- Do not invent topics. Only reference what's in the data.
- Do not reinterpret values. "Service" = serving others. "Autonomy" = independence. Use them as-is.
- Write like a real person speaking, NOT like an app reporting metrics. Banned jargon phrasings: "reflection score was Some", "goal health was 88%", "consistency score", quoting a scale label (Drifted/Some/Mostly/Aligned) as if it were a value. Translate every number and label into plain words (a percentage may appear naturally in passing).
- For how the user felt about a value, use natural phrasing like "you've felt only loosely connected to Professional Respect lately" — never "reflection score was Some".
- Every sentence must be complete and grammatical. Do NOT tack on a trailing fragment or repeat a phrase (e.g. "…continued progress. progress towards your goals.").
- When you mention a streak, always write the plain-language phrase from the data (e.g. "4 days in a row", "3 weeks running"). NEVER write a bare number like "streak is 4" or "your streak is 4" — the user has no idea what that number counts.
- NEVER propose a task marked "DONE (already completed)" as today's nudge, or invent a follow-on step for one (no "gather the supplies", "finish packing" for a prep task that's already done). A DONE task may ONLY be acknowledged as a past accomplishment — the concrete nudge (goal #3) MUST be an open task (status "due:...") or a habit due today.
${sprintFocusRule}
${rotateRule ? `- ${rotateRule}` : ''}
${focusDomainRule}

Your goal:
1. Acknowledge one real thing — a streak, a completed task, a goal nearing its end, a habit slipping.
2. Surface a pattern the user may not have noticed (e.g. consistency gap, a value underserved by current habits).
3. Give one concrete nudge for today tied to a named habit or goal.

Tone: direct, warm, no filler. Like a coach who actually read the data.

Format:
- Title: 4–6 words. Must contain a real habit or goal name.
- Blurb: exactly 2 sentences. Sentence 1: specific encouragement from data. Sentence 2: one actionable nudge naming a real item.
${feedbackLines}${groundingBlock}
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
      temperature: 0.8,
    },
  };

  const data = await callGemini(body);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const card = JSON.parse(text) as CoachCard;

  localStorage.setItem(coachCacheKey(today, domains, sprintFocusGoal?.id), JSON.stringify(card));
  return card;
}
