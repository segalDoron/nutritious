// POST /api/analyze
// body: { imageBase64: string, mimeType: string }
// Uses Google Gemini's free tier (vision + JSON mode) to read a nutrition label.
// GEMINI_API_KEY must be set as an environment variable in the Vercel project — never sent to the client.
//
// Quota strategy: Gemini's free-tier rate limits are tracked PER MODEL, not per account.
// So we try a small chain of vision-capable models — if the first is out of daily quota (429),
// we automatically fall through to the next one. Same API key, no extra signup, more effective
// free capacity per day.

import { callGeminiChain } from "../lib/gemini.js";

const MODEL_CHAIN = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"];

const SYSTEM_PROMPT =
  "אתה מנתח תוויות תזונה. תפקידך היחיד: לקרוא מהתמונה את טבלת הערכים התזונתיים " +
  "(ל-100 גרם) ולהחזיר JSON תקין בלבד לפי הסכימה שסופקה. " +
  "אם התמונה לא ברורה מספיק כדי לקרוא ערכים, החזר found:false. " +
  "אל תמציא מספרים — אם ערך מסוים לא מופיע בתווית, השאר אותו null.";

const SCHEMA_HINT =
  'קרא את טבלת הערכים התזונתיים בתמונה (ל-100 גרם) והחזר JSON לפי הסכימה: ' +
  '{"found": boolean, "product_name_guess": string|null, "confidence": "high"|"medium"|"low", ' +
  '"energy_kcal_100g": number|null, "carbs_g_100g": number|null, "sugars_g_100g": number|null, ' +
  '"fiber_g_100g": number|null, "fat_g_100g": number|null, "protein_g_100g": number|null, ' +
  '"sodium_mg_100g": number|null, "notes": string}. השדות הטקסטואליים בעברית.';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: "missing_image", message: "לא התקבלה תמונה." });
  }

  const contents = [
    {
      role: "user",
      parts: [
        { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } },
        { text: SCHEMA_HINT },
      ],
    },
  ];

  try {
    const { text, modelUsed } = await callGeminiChain({
      models: MODEL_CHAIN,
      systemPrompt: SYSTEM_PROMPT,
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "parse_error",
        message: "לא הצלחנו לפענח את תשובת המנתח: " + text.slice(0, 150),
      });
    }

    parsed._model_used = modelUsed; // harmless debug field, ignored by the UI
    return res.status(200).json(parsed);
  } catch (err) {
    if (err.code === "missing_api_key") {
      return res.status(500).json({ error: "missing_api_key", message: err.message });
    }
    if (err.code === "gemini_chain_exhausted") {
      return res.status(429).json({
        error: "quota_exhausted",
        message: "כל המודלים החינמיים הזמינים כרגע עמוסים. נסו שוב בעוד כמה דקות.",
        detail: err.lastError,
      });
    }
    return res.status(500).json({ error: "server_error", message: "שגיאת שרת. נסו שוב.", detail: String(err) });
  }
}
