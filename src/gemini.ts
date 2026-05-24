const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export const geminiAvailable = !!API_KEY;

export async function callGemini(prompt: string): Promise<string> {
  if (!API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set');
  const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}

export interface PromptContext {
  values?: string[];
  selectedValues?: string[];
  timeframe?: string;
  vision?: string;
  existingGoals?: string[];
  parentGoal?: string;
  goalTitle?: string;
}

function ctx(c: PromptContext): string {
  const lines: string[] = [];
  if (c.vision) lines.push(`Domain vision: ${c.vision}`);
  if (c.selectedValues?.length) lines.push(`Values this goal serves: ${c.selectedValues.join(', ')}`);
  else if (c.values?.length) lines.push(`Core values: ${c.values.join(', ')}`);
  if (c.timeframe) lines.push(`Timeframe: ${c.timeframe}`);
  if (c.parentGoal) lines.push(`Parent long-term goal: ${c.parentGoal}`);
  if (c.goalTitle) lines.push(`Goal this belongs to: ${c.goalTitle}`);
  if (c.existingGoals?.length) lines.push(`Already committed to: ${c.existingGoals.join('; ')}`);
  return lines.length ? '\n\n' + lines.join('\n') : '';
}

export const PROMPTS = {
  ltGoal: (text: string, c: PromptContext = {}) => text.trim()
    ? `You are a personal growth coach. Improve this long-term goal to be specific, inspiring, and achievable within the timeframe. Return only the improved title, no quotes, no explanation.${ctx(c)}\n\nGoal to improve: "${text}"`
    : `You are a personal growth coach. Suggest one specific, inspiring long-term goal that fits the timeframe and aligns with the user's context. Return only the goal title, no quotes, no explanation.${ctx(c)}`,

  stGoal: (text: string, c: PromptContext = {}) => text.trim()
    ? `You are a personal growth coach. Improve this short-term goal to be concrete, achievable within the timeframe, and directly supportive of the user's context. Return only the improved title, no quotes, no explanation.${ctx(c)}\n\nGoal to improve: "${text}"`
    : `You are a personal growth coach. Suggest one specific, achievable short-term goal that fits the timeframe and aligns with the user's context. Return only the goal title, no quotes, no explanation.${ctx(c)}`,

  habit: (text: string, c: PromptContext = {}) => text.trim()
    ? `You are a personal growth coach. Improve this habit to be a clear, brief recurring action aligned with the user's goal. Return only the improved habit name, no quotes, no explanation.${ctx(c)}\n\nHabit to improve: "${text}"`
    : `You are a personal growth coach. Suggest one clear recurring habit that directly supports the user's goal. Return only the habit name, no quotes, no explanation.${ctx(c)}`,

  task: (text: string, c: PromptContext = {}) => text.trim()
    ? `You are a personal growth coach. Improve this task to be a specific, actionable to-do item aligned with the user's goal. Return only the improved task, no quotes, no explanation.${ctx(c)}\n\nTask to improve: "${text}"`
    : `You are a personal growth coach. Suggest one specific actionable task that directly moves the user's goal forward. Return only the task, no quotes, no explanation.${ctx(c)}`,

  vision: (text: string, c: PromptContext = {}) => text.trim()
    ? `You are a personal growth coach. Improve this life domain vision statement to be inspiring, personal, and concrete. 2–3 sentences max. Return only the improved vision, no explanation.${ctx(c)}\n\nVision to improve: "${text}"`
    : `You are a personal growth coach. Write an inspiring, personal life domain vision statement. 2–3 sentences max. Return only the vision, no explanation.${ctx(c)}`,
};
