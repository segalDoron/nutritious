// POST /api/chat
// body: { nutrition: {...}, profileLabel: string, history: [{role:'user'|'assistant', content:string}], message: string }
//
// This endpoint deliberately does NOT call Gemini. Gemini's free-tier quota is reserved entirely
// for /api/analyze.js (the image analysis step), which is the heaviest and most important call —
// it's the one thing nothing else here can substitute for. Chat is a simple back-and-forth about
// data that's already been extracted, so a lighter free provider is plenty.
//
// Fallback chain for this endpoint (both free, no card required):
// 1. OpenRouter (free auto-router) — an independent free provider, rotates across whichever open
//    model is currently free there. Requires OPENROUTER_API_KEY.
// 2. Groq (llama-3.3-70b) — a second, independent free provider, tried if OpenRouter is unset or
//    exhausted. Requires GROQ_API_KEY.
//
// At least one of the two keys must be set for chat to work.

import { callOpenRouterFallback } from "../lib/openrouter.js";
import { callGroqFallback } from "../lib/groq.js";

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

  if (!process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "missing_api_key",
      message: "הצ'אט דורש לפחות אחד מהמפתחות OPENROUTER_API_KEY או GROQ_API_KEY בהגדרות הפרויקט ב-Vercel.",
    });
  }

  const { nutrition, profileLabel, history, message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "missing_message", message: "לא נשלחה שאלה." });
  }

  const priorTurns = Array.isArray(history) ? history : [];
  const systemPrompt = buildSystemPrompt(nutrition, profileLabel);
  const chatMessages = [...priorTurns, { role: "user", content: message }];

  // Tier 1: OpenRouter free router
  try {
    const { text } = await callOpenRouterFallback({ systemPrompt, messages: chatMessages, maxTokens: 400 });
    return res.status(200).json({ reply: text, provider: "openrouter" });
  } catch (openrouterErr) {
    // fall through to Groq
  }

  // Tier 2: Groq
  try {
    const { text } = await callGroqFallback({ systemPrompt, messages: chatMessages, maxTokens: 400 });
    return res.status(200).json({ reply: text, provider: "groq" });
  } catch (groqErr) {
    return res.status(429).json({
      error: "all_providers_exhausted",
      message: "כל המקורות החינמיים עמוסים כרגע. נסו שוב בעוד כמה דקות.",
    });
  }
}
