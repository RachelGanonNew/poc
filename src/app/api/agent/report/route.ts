import { NextRequest, NextResponse } from "next/server";
import { agentGet } from "@/lib/agentStore";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getOmniContext } from "@/lib/omnisenseStore";

export async function GET(_req: NextRequest) {
  try {
    const sess = agentGet();
    if (!sess) return NextResponse.json({ error: "no_active_session" }, { status: 400 });

    const { preferences, systemInstruction } = getOmniContext();
    const privacy = preferences?.privacyMode || "cloud";
    const apiKey = process.env.GEMINI_API_KEY;

    const outline = {
      sessionId: sess.id,
      startedAt: sess.startedAt,
      endedAt: sess.endedAt,
      stats: sess.stats || {},
      insights: (sess.events || []).filter((e) => e.type === "insight").map((e) => e.data).slice(-50),
    };

    if (!apiKey || privacy !== "cloud") {
      // Local fallback summary
      const actions = outline.insights.slice(-5).map((i: any, idx: number) => ({
        title: (i?.action_recommendation || "Follow up") + " (#" + (idx + 1) + ")",
      }));
      return NextResponse.json({
        mode: "local",
        summary: "Session concluded. Key insights captured. See actions below.",
        risks: ["Potential over-talking detected", "Energy dips observed"],
        actions,
        outline,
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-3.0-pro" });
    const prompt = `${systemInstruction}

Create a concise post-meeting report from recent insights. Return ONLY JSON with keys: summary, risks (array of strings), actions (array of {title, owner?, due?}).
Do not include any sensitive attributes. Keep total under 180 words.

Recent insights: ${JSON.stringify(outline.insights).slice(0, 8000)}`;
    const resp = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
    let text = resp.response.text().trim();
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
    const json = JSON.parse(text);
    return NextResponse.json({ mode: "cloud", ...json, outline });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
