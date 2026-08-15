// lib/groq.js
// Groq (groq.com — a different company from xAI's Grok) runs open models (Llama, etc.)
// on its own hardware with a real ongoing free tier: no card, ~14,400 requests/day.
// It's used here as a last-resort text-only fallback when every Gemini model in the
// chain is exhausted. GROQ_API_KEY is optional — if it's not set, this is simply skipped.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

/**
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {number} maxTokens
 * @returns {Promise<{text: string}>}
 */
export async function callGroqFallback({ systemPrompt, messages, maxTokens = 500, temperature = 0.5 }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error("GROQ_API_KEY not configured (optional fallback skipped).");
    err.code = "no_groq_key";
    throw err;
  }

  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    const err = new Error("Groq request failed: " + detail.slice(0, 300));
    err.code = "groq_error";
    err.status = r.status;
    throw err;
  }

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) {
    const err = new Error("Groq returned an empty response.");
    err.code = "groq_empty";
    throw err;
  }
  return { text };
}
