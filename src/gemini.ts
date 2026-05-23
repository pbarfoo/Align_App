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

export const PROMPTS = {
  ltGoal: (text: string) =>
    `You are a personal growth coach. The user is setting a long-term goal (1–5 years). Improve their goal title to be specific, inspiring, and outcome-focused. Return only the improved title, no quotes, no explanation.\n\nUser input: "${text}"`,
  stGoal: (text: string) =>
    `You are a personal growth coach. The user is setting a short-term goal (1–12 months). Improve their goal title to be concrete, achievable, and motivating. Return only the improved title, no quotes, no explanation.\n\nUser input: "${text}"`,
  habit: (text: string) =>
    `You are a personal growth coach. Improve this habit name to be a clear, brief daily action. Return only the improved habit name, no quotes, no explanation.\n\nUser input: "${text}"`,
  task: (text: string) =>
    `You are a personal growth coach. Improve this task to be a specific, actionable to-do item. Return only the improved task, no quotes, no explanation.\n\nUser input: "${text}"`,
  vision: (text: string) =>
    `You are a personal growth coach. Improve this life domain vision statement to be inspiring, personal, and concrete. 2–3 sentences max. Return only the improved vision, no explanation.\n\nUser input: "${text}"`,
};
