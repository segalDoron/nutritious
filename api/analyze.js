// POST /api/analyze
// body: { imageBase64: string, mimeType: string }
// Uses Google Gemini's free tier (vision + JSON mode) to read a nutrition label.
// GEMINI_API_KEY must be set as an environment variable in the Vercel project — never sent to the client.

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "missing_api_key", message: "GEMINI_API_KEY לא מוגדר בהגדרות הפרויקט ב-Vercel." });
  }

  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: "missing_image", message: "לא התקבלה תמונה." });
  }

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } },
          { text: SCHEMA_HINT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "low" },
    },
  };

  try {
    const r = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errText = await r.text();
      const status = r.status === 429 ? 429 : 502;
      return res.status(status).json({
        error: "gemini_error",
        message:
          r.status === 429
            ? "חרגתם מהמכסה החינמית הזמנית של Gemini. נסו שוב בעוד דקה."
            : "שגיאה בשירות הניתוח: " + errText.slice(0, 200),
        detail: errText.slice(0, 500),
      });
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    if (!text.trim()) {
      const finishReason = data?.candidates?.[0]?.finishReason || "unknown";
      return res.status(502).json({
        error: "empty_response",
        message: "המנתח החזיר תשובה ריקה (סיבה: " + finishReason + "). נסו שוב.",
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "parse_error",
        message: "לא הצלחנו לפענח את תשובת המנתח: " + text.slice(0, 150),
      });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "server_error", message: "שגיאת שרת. נסו שוב.", detail: String(err) });
  }
}
