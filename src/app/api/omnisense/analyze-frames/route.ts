import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getOmniContext } from "@/lib/omnisenseStore";
import { allowRequest, coerceInsight, scoreConfidence } from "@/lib/validate";
import { agentAddEvent } from "@/lib/agentStore";
import { addPersonSeen } from "@/lib/memoryStore";
import { appendInteraction, buildLongMemorySnippet } from "@/lib/longMemory";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const ip = req.headers.get("x-forwarded-for") || "local";
    if (!allowRequest(ip, "omni-analyze-frames", 400)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const body = await req.json();
    const frames: { dataUrl?: string; base64?: string; mime?: string }[] = body?.frames || [];
    const transcript: string = body?.transcript || "";
    const overrideSystemInstruction: string | undefined = body?.overrideSystemInstruction;

    if (!Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json({ error: "frames array required" }, { status: 400 });
    }

    const { systemInstruction, preferences, historySnippet } = getOmniContext();
    const system = overrideSystemInstruction || systemInstruction;
    const longMemory = await buildLongMemorySnippet({ preferences: preferences || {}, limit: 18, maxChars: 1600 });

    // Privacy enforcement
    const privacy = preferences?.privacyMode || "cloud";
    if (privacy === "off") {
      return NextResponse.json({ error: "privacy_off" }, { status: 403 });
    }

    if (!apiKey || privacy === "local") {
      const sample = coerceInsight({
        insight_type: "Logistical",
        observation: "Video frames suggest fragmented attention and side-chatter",
        analysis: "Energy appears low; timeboxing decisions and a quick break may help.",
        action_recommendation: "Pause 5 minutes, then capture 3 decisions with owners and dates.",
      });
      sample.confidence = 0.5;
      agentAddEvent("insight", { source: "frames-demo", transcript: transcript.slice(0, 200), ...sample });
      try {
        await appendInteraction(
          "omni.analyze_frames.local",
          {
            input: { frames: frames.length, transcript: transcript.slice(0, 1000) },
            output: sample,
            meta: { privacy, ip },
            preferences: preferences || {},
          },
          { maxItems: 800 }
        );
      } catch {}
      if (transcript) {
        const m = transcript.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g);
        if (m) m.slice(0, 3).forEach((n: string) => addPersonSeen(n));
      }
      return NextResponse.json(sample);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-3.0-pro" });

    // Build parts with inline images
    const imageParts = frames.slice(0, 12).map((f) => {
      let mimeType = f.mime || "image/png";
      let b64 = f.base64;
      if (!b64 && f.dataUrl) {
        const m = f.dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (m) {
          mimeType = m[1] || mimeType;
          b64 = m[2];
        }
      }
      if (!b64) return null as any;
      return { inlineData: { mimeType, data: b64 } };
    }).filter(Boolean) as any[];

    const header = `${system}

User Context (short): ${JSON.stringify(preferences || {})}
History Snippet: ${historySnippet || ""}

LongTermMemory (recent interactions; may be empty):
${longMemory || ""}

Instructions:
- Analyze the set of frames together with transcript (if any).
- Return ONLY JSON with keys: insight_type, observation, analysis, action_recommendation.
- Be concise, proactive, and avoid sensitive attribute inferences.`;

    const contents: any[] = [
      { role: "user", parts: [{ text: header }] },
    ];
    if (imageParts.length) {
      contents.push({ role: "user", parts: imageParts });
    }
    if (transcript) {
      contents.push({ role: "user", parts: [{ text: `Transcript snippet: ${transcript.slice(0, 1000)}` }] });
    }

    // Simple retry/backoff for transient failures
    const genOnce = async () => await model.generateContent({ contents });
    let resp: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        resp = await genOnce();
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    let text = resp.response.text().trim();
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
    const parsed = JSON.parse(text);
    const coerced = coerceInsight(parsed);
    const conf = await scoreConfidence(genAI, coerced);
    coerced.confidence = conf;
    agentAddEvent("insight", { source: "frames", transcript: transcript.slice(0, 200), ...coerced });
    try {
      await appendInteraction(
        "omni.analyze_frames",
        {
          input: { frames: frames.length, transcript: transcript.slice(0, 1000) },
          output: coerced,
          meta: { ip },
          preferences: preferences || {},
        },
        { maxItems: 800 }
      );
    } catch {}
    return NextResponse.json(coerced);
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
