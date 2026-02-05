import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
    }
    const body = await req.json();
    const { intensityPct, speaking, interruption } = body ?? {};
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-3.0-pro" });

    const system = `Role: You are the Social Intelligence Interpreter (Social Translator).
Your purpose is to help the user interpret subtext and social intent, especially sarcasm, passive aggression, and condescension.

Rules:
- Output must be plain human-readable English. Never output JSON or code.
- Be direct about social risk (manipulative/concedescending cues), but do not insult.
- Do not infer protected traits or identity.
- Keep it short and speakable.

Required structure (4 short lines):
The Vibe: ...
The Hidden Meaning: ...
Social Red Flags: ...
The Social Script: What to say: ...`;
    const user = `Live audio dynamics only (no transcript):
- Intensity (0-100): ${Number(intensityPct) || 0}
- Speaking: ${!!speaking}
- Interruption: ${interruption ? "yes" : "no"}

Generate the 4-line structured output. If interruption=yes, prioritize de-escalation and inclusion.
If speaking=true and intensity is high, encourage brevity and invite others.`;

    const res = await model.generateContent({ contents: [
      { role: "user", parts: [{ text: system }] },
      { role: "user", parts: [{ text: user }] },
    ]});
    const text = res.response.text().trim();
    return NextResponse.json({ suggestion: text.slice(0, 180) });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
