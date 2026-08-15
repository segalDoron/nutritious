// lib/gemini.js
// Calls a chain of Gemini models in order. Google's free-tier rate limits (RPM/RPD)
// are tracked PER MODEL, not per account — so trying a second/third model name on
// the same API key is a genuine way to get more free daily capacity, no new signup needed.

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * @param {string[]} models - model ids to try in order, e.g. ["gemini-3.5-flash", "gemini-2.5-flash"]
 * @param {string} systemPrompt
 * @param {Array}  contents - Gemini "contents" array
 * @param {object} generationConfig
 * @returns {Promise<{text: string, modelUsed: string}>}
 */
export async function callGeminiChain({ models, systemPrompt, contents, generationConfig }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY לא מוגדר בהגדרות הפרויקט ב-Vercel.");
    err.code = "missing_api_key";
    throw err;
  }

  let lastError = null;

  for (const model of models) {
    try {
      const r = await fetch(`${BASE_URL}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig,
        }),
      });

      if (r.status === 429) {
        lastError = { status: 429, model, detail: "quota exhausted for this model" };
        continue; // try the next model in the chain
      }
      if (!r.ok) {
        const detail = await r.text();
        lastError = { status: r.status, model, detail };
        continue;
      }

      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      const finishReason = data?.candidates?.[0]?.finishReason || "unknown";

      if (!text.trim()) {
        lastError = { status: 502, model, detail: "empty response, finishReason=" + finishReason };
        continue;
      }

      return { text, modelUsed: model };
    } catch (e) {
      lastError = { status: 500, model, detail: String(e) };
    }
  }

  const err = new Error("All Gemini models in the chain failed.");
  err.code = "gemini_chain_exhausted";
  err.lastError = lastError;
  throw err;
}
