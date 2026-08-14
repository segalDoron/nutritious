// POST /api/chat
// body: { nutrition: {...}, profileLabel: string, history: [{role:'user'|'assistant', content:string}], message: string }

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function fmt(v, unit) {
  return v === null || v === undefined ? "לא ידוע" : `${v}${unit ? " " + unit : ""}`;
}

function buildSystemPrompt(nutrition, profileLabel) {
  const n = nutrition || {};
  return (
    "אתה עוזר שמסביר אך ורק את נתוני התזונה של מוצר יחיד שנותח מתווית, ואת התאמתו לפרופיל המשתמש. " +
    `נתוני המוצר (ל-100 גרם): אנרגיה ${fmt(n.energy_kcal_100g, 'קק"ל')}, פחמימות ${fmt(n.carbs_g_100g, "ג'")}, ` +
    `סוכרים ${fmt(n.sugars_g_100g, "ג'")}, סיבים ${fmt(n.fiber_g_100g, "ג'")}, שומן ${fmt(n.fat_g_100g, "ג'")}, ` +
    `חלבון ${fmt(n.protein_g_100g, "ג'")}, נתרן ${fmt(n.sodium_mg_100g, 'מ"ג')}. שם משוער: ${n.product_name_guess || "לא ידוע"}. ` +
    `פרופיל המשתמש: ${profileLabel || "לא צוין"}. ` +
    "אם נשאלת שאלה שאינה קשורה למוצר הזה ולנתונים התזונתיים/לפרופיל שלו — סרב בנימוס והסבר שאתה יכול לעזור רק " +
    "בהקשר של המוצר שנותח. אל תיתן אבחנה או ייעוץ רפואי מחייב; הזכר בקצרה כשרלוונטי שכדאי להתייעץ עם רופא/ה או " +
    "דיאטן/ית. ענה בעברית, בקצרה ובבהירות (עד 4 משפטים)."
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "missing_api_key", message: "GEMINI_API_KEY לא מוגדר בהגדרות הפרויקט ב-Vercel." });
  }

  const { nutrition, profileLabel, history, message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "missing_message", message: "לא נשלחה שאלה." });
  }

  const contents = [
    ...(Array.isArray(history) ? history : []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const payload = {
    system_instruction: { parts: [{ text: buildSystemPrompt(nutrition, profileLabel) }] },
    contents,
    generationConfig: { maxOutputTokens: 400, temperature: 0.5 },
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
        message: r.status === 429 ? "חרגתם מהמכסה החינמית הזמנית. נסו שוב בעוד דקה." : "שגיאה בקבלת תשובה.",
        detail: errText.slice(0, 500),
      });
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
    return res.status(200).json({ reply: text });
  } catch (err) {
    return res.status(500).json({ error: "server_error", message: "שגיאת שרת. נסו שוב.", detail: String(err) });
  }
}
