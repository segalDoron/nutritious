// POST /api/recommend
// body: { nutrition: {...}, profileLabel: string }

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "missing_api_key", message: "GEMINI_API_KEY לא מוגדר בהגדרות הפרויקט ב-Vercel." });
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

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: { maxOutputTokens: 1200, temperature: 0.5, thinkingConfig: { thinkingLevel: "low" } },
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
        message: r.status === 429 ? "חרגתם מהמכסה החינמית הזמנית. נסו שוב בעוד דקה." : "שגיאה בהפקת ההמלצה: " + errText.slice(0, 200),
        detail: errText.slice(0, 500),
      });
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: "server_error", message: "שגיאת שרת. נסו שוב.", detail: String(err) });
  }
}
