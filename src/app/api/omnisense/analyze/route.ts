import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getOmniContext } from "@/lib/omnisenseStore";
import { allowRequest, coerceInsight, scoreConfidence } from "@/lib/validate";
import { agentAddEvent, agentGet } from "@/lib/agentStore";
import { addPersonSeen } from "@/lib/memoryStore";
import { appendInteraction, buildLongMemorySnippet } from "@/lib/longMemory";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Demo mode fallback so public deployments can be explored without a key
      const body = await req.json().catch(() => ({}));
      const sample = coerceInsight({
        insight_type: "Social",
        observation: "Balanced turn-taking could be improved",
        analysis: "One voice dominates; others paused. Consider inviting input and clarifying next steps.",
        action_recommendation:
          "The Vibe: Slightly tense; one person dominates.\n" +
          "The Hidden Meaning: Others may be holding back.\n" +
          "Social Red Flags: Little turn-taking; long monologue.\n" +
          "The Social Script: What to say: ‘Quick check—anyone else want to weigh in?’",
      });
      sample.confidence = 0.5;
      agentAddEvent("insight", sample);
      try {
        const { preferences } = getOmniContext();
        await appendInteraction(
          "omni.analyze.demo",
          { input: body, output: sample, meta: { mode: "no_api_key" }, preferences: preferences || {} },
          { maxItems: 800 }
        );
      } catch {}
      return NextResponse.json(sample);
    }
    // Simple rate limit per IP
    const ip = req.headers.get("x-forwarded-for") || "local";
    if (!allowRequest(ip, "omni-analyze", 400)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    const body = await req.json();

    const {
      audioDynamics, // { intensityPct:number, speaking:boolean, interruption:boolean }
      visionHints,   // { scene?: string, objects?: string[] }
      transcript,    // partial ASR text
      overrideSystemInstruction,
    } = body || {};

    const { systemInstruction, preferences, historySnippet } = getOmniContext();
    const sess = agentGet();
    const fp = sess?.stats?.falsePositives || 0;
    const imp = sess?.stats?.improvements || 0;
    let tuning = "";
    if (fp - imp >= 3) {
      tuning = "Be more conservative; only output recommendations when highly supported. Prefer observations over strong actions.";
    } else if (imp - fp >= 3) {
      tuning = "Be more proactive; suggest specific next actions where appropriate.";
    }
    const system = overrideSystemInstruction || systemInstruction;
    const longMemory = await buildLongMemorySnippet({ preferences: preferences || {}, limit: 24, maxChars: 2200 });

    // Privacy enforcement
    const privacy = preferences?.privacyMode || "cloud";
    if (privacy === "off") {
      return NextResponse.json({ error: "privacy_off" }, { status: 403 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-3.0-pro" });

    const prompt = `${system}

User Context (short): ${JSON.stringify(preferences || {})}
History Snippet: ${historySnippet || ""}

Live Observations:
- Audio: ${JSON.stringify(audioDynamics || {})}
- Vision: ${JSON.stringify(visionHints || {})}
- Transcript: ${transcript || ""}

LongTermMemory (recent interactions; may be empty):
${longMemory || ""}

Instructions:
- Return ONLY a JSON object with keys: insight_type, observation, analysis, action_recommendation.
- Set insight_type to "Social".
- Keep it concise and actionable.
- Avoid sensitive attribute inferences; do not mention biometrics or identity.
- action_recommendation MUST be 4 short lines, exactly:
  The Vibe: ...
  The Hidden Meaning: ...
  Social Red Flags: ...
  The Social Script: What to understand: ... What to say: ... What to do: ...
${tuning ? `\nTuning: ${tuning}` : ""}
`;

    // If privacy local mode, avoid cloud calls, return heuristic demo insight
    if (privacy === "local") {
      const local = coerceInsight({
        insight_type: "Strategic",
        observation: "Local mode enabled — providing generic advice",
        analysis: "Based on audio dynamics and transcript snippet only.",
        action_recommendation:
          "The Vibe: Neutral (local privacy mode).\n" +
          "The Hidden Meaning: Limited context; using safe defaults.\n" +
          "Social Red Flags: None detected with high confidence.\n" +
          "The Social Script: What to say: ‘Let’s pause—what’s the main point?’",
      });
      local.confidence = 0.45;
      agentAddEvent("insight", local);
      try {
        await appendInteraction(
          "omni.analyze.local",
          { input: { audioDynamics, visionHints, transcript }, output: local, meta: { privacy }, preferences: preferences || {} },
          { maxItems: 800 }
        );
      } catch {}
      // Memory: naive person extraction from transcript
      if (transcript) {
        const m = transcript.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g);
        if (m) m.slice(0, 3).forEach((n: string) => addPersonSeen(n));
      }
      return NextResponse.json(local);
    }

    // Simple retry/backoff for transient failures
    const genOnce = async () => await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
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

    // Try to extract JSON
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
    const parsed = JSON.parse(text);
    const coerced = coerceInsight(parsed);
    const conf = await scoreConfidence(genAI, coerced);
    coerced.confidence = conf;
    agentAddEvent("insight", coerced);
    try {
      await appendInteraction(
        "omni.analyze",
        {
          input: { audioDynamics, visionHints, transcript },
          output: coerced,
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
    return NextResponse.json(coerced);
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
