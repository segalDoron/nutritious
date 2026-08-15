// POST /api/recommend
// body: { nutrition: {...}, profileLabel: string }
//
// Fallback chain (all free, no card required anywhere):
// 1. gemini-3.5-flash-lite  — separate free-tier quota bucket from the vision models in analyze.js
// 2. gemma-3-27b-it         — served through the same Gemini API key, its own separate quota bucket
// 3. Groq (llama-3.3-70b)   — a different, independent free provider (only used if GEMINI_API_KEY's
//                              models are all exhausted). Optional: set GROQ_API_KEY to enable it.

import { callGeminiChain } from "../lib/gemini.js";
import { callGroqFallback } from "../lib/groq.js";

const MODEL_CHAIN = ["gemini-3.5-flash-lite", "gemma-3-27b-it"];

const SYSTEM_PROMPT =
  "אתה עוזר אוריינות תזונתית עבור אנשים עם סוכרת. אתה נותן מידע כללי בלבד, לא ייעוץ רפואי מחייב ולא אבחון. " +
  "היה עדין, מעשי וברור. ענה בעברית, 3-5 משפטים קצרים, ללא כותרות markdown וללא רשימות.";

function fmt(v, unit) {
  return v === null || v === undefined ? "לא ידוע" : `${v}${unit ? " " + unit : ""}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { nutrition, profileLabel } = req.body || {};
  if (!nutrition || !profileLabel) {
    return res.status(400).json({ error: "missing_fields", message: "חסרים נתוני תזונה או פרופיל." });
  }

  const userMsg =
    `נתוני התזונה שחולצו מהתווית (ל-100 גרם): אנרגיה ${fmt(nutrition.energy_kcal_100g, 'קק"ל')}, ` +
    `פחמימות ${fmt(nutrition.carbs_g_100g, "גרם")}, סוכרים ${fmt(nutrition.sugars_g_100g, "גרם")}, ` +
    `סיבים ${fmt(nutrition.fiber_g_100g, "גרם")}.\n` +
    `פרופיל המשתמש: ${profileLabel}.\n` +
    "כתוב המלצה קצרה ומעשית: האם ובאיזו זהירות לצרוך את המוצר, מה כדאי לשים לב אליו " +
    "(למשל גודל מנה, שילוב עם חלבון/סיבים), והזכר בעדינות שמדובר במידע כללי בלבד.";

  // 1 & 2: Gemini chain
  try {
    const { text } = await callGeminiChain({
      models: MODEL_CHAIN,
      systemPrompt: SYSTEM_PROMPT,
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: { maxOutputTokens: 1200, temperature: 0.5, thinkingConfig: { thinkingLevel: "low" } },
    });
    return res.status(200).json({ text });
  } catch (geminiErr) {
    if (geminiErr.code === "missing_api_key") {
      return res.status(500).json({ error: "missing_api_key", message: geminiErr.message });
    }
    // 3: Groq fallback (only if configured)
    try {
      const { text } = await callGroqFallback({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 500,
      });
      return res.status(200).json({ text, provider: "groq_fallback" });
    } catch (groqErr) {
      return res.status(429).json({
        error: "all_providers_exhausted",
        message: "כל המקורות החינמיים עמוסים כרגע. נסו שוב בעוד כמה דקות.",
      });
    }
  }
}
