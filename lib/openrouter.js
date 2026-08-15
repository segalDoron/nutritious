// lib/openrouter.js
// OpenRouter (openrouter.ai) is a well-known aggregator that gives free, no-card access to a
// rotating pool of open models (Llama, Gemma, DeepSeek, etc.) through one API key.
// Free tier: ~20 requests/minute, 50-1000 requests/day depending on account history.
//
// The individual ":free" model IDs (e.g. "meta-llama/llama-3.3-70b-instruct:free") rotate in and
// out of the catalog fairly often as providers add/remove free access. To avoid hardcoding a model
// that might get delisted, we use OpenRouter's own "openrouter/free" router model, which picks
// whichever free model is currently available — simpler and more resilient for a fallback tier
// that just needs to answer short questions reliably.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openrouter/free";

/**
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @returns {Promise<{text: string}>}
 */
export async function callOpenRouterFallback({ systemPrompt, messages, maxTokens = 400, temperature = 0.5 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENROUTER_API_KEY not configured (optional fallback skipped).");
    err.code = "no_openrouter_key";
    throw err;
  }

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter uses these purely for attribution/rankings on their dashboard — not required to function.
      "HTTP-Referer": "https://nutritious.vercel.app/",
      "X-Title": "קראו את התווית",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    const err = new Error("OpenRouter request failed: " + detail.slice(0, 300));
    err.code = "openrouter_error";
    err.status = r.status;
    throw err;
  }

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) {
    const err = new Error("OpenRouter returned an empty response.");
    err.code = "openrouter_empty";
    throw err;
  }
  return { text };
}
