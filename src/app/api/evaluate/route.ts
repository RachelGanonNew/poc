import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getOmniContext } from "@/lib/omnisenseStore";
import { coerceInsight, scoreConfidence } from "@/lib/validate";

function extractJsonBlock(text: string): string {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) return text.slice(s, e + 1);
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a >= 0 && b > a) return text.slice(a, b + 1);
  return text;
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });

    const { systemInstruction, preferences, historySnippet } = getOmniContext();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-3.0-pro" });

     const url = new URL(req.url);
     const n = Math.max(1, Math.min(6, Number(url.searchParams.get("n") || 4)));

     // Generate diverse, non-predefined scenarios dynamically
     const genPrompt = `Generate ${n} diverse meeting micro-scenarios for evaluating a Social Intelligence Interpreter.
Return ONLY JSON array, each item:
{ "title": string, "transcript": string, "visionHints"?: {"scene"?: string, "objects"?: string[]} }

Requirements:
- Scenarios must be novel (not numbered templates).
- Include a mix: sarcasm/teasing, passive-aggression, hierarchy/chain-of-command tension, location/context cues.
- Keep transcript 1-2 sentences, no protected traits.
`;

     const genResp = await model.generateContent({ contents: [{ role: "user", parts: [{ text: genPrompt }] }] });
     let casesText = extractJsonBlock(genResp.response.text().trim());
     let cases: Array<{ title: string; transcript: string; visionHints?: any }> = [];
     try {
       const parsed = JSON.parse(casesText);
       cases = Array.isArray(parsed) ? parsed : [];
     } catch {
       cases = [];
     }

    const results: any[] = [];
    for (let i = 0; i < Math.min(n, cases.length); i++) {
      const c = cases[i];
      const header = `${systemInstruction}

User Context (short): ${JSON.stringify(preferences || {})}
History Snippet: ${historySnippet || ""}

Instructions:
- Consider transcript and basic vision hints.
- Return ONLY JSON with keys: insight_type, observation, analysis, action_recommendation.
- insight_type must be "Social".
- action_recommendation should be the 4-line Social Translator structure (Vibe / Hidden Meaning / Social Red Flags / Social Script).
- Be concise, actionable, and avoid sensitive attribute inferences.`;

      const contents: any[] = [
        { role: "user", parts: [{ text: header }] },
        { role: "user", parts: [{ text: `Transcript snippet: ${String(c?.transcript || "").slice(0, 1000)}` }] },
      ];
      if (c?.visionHints) {
        contents.push({ role: "user", parts: [{ text: `Vision hints: ${JSON.stringify(c.visionHints)}` }] });
      }

      const resp = await model.generateContent({ contents });
      let text = extractJsonBlock(resp.response.text().trim());
      const parsed = JSON.parse(text);
      const coerced = coerceInsight(parsed);
      coerced.confidence = await scoreConfidence(genAI, coerced);

      // Dynamic rubric scoring (no fixed rules): judge how well the output demonstrates key competencies.
      const rubricPrompt = `Score the assistant output for quality across these competencies (0 to 1). Return ONLY JSON.

Competencies:
- high_reasoning: nuanced interpretation grounded in evidence, not speculation
- chain_of_command: recognizes hierarchy/power dynamics when relevant
- location_awareness: uses scene/context cues appropriately
- social_interaction: identifies subtext, sarcasm, tension, and gives a safe script

Return JSON:
{ "high_reasoning": number, "chain_of_command": number, "location_awareness": number, "social_interaction": number, "notes": string }

Scenario transcript: ${String(c?.transcript || "").slice(0, 800)}
Scenario visionHints: ${JSON.stringify(c?.visionHints || {})}

Assistant output:
observation: ${coerced.observation}
analysis: ${coerced.analysis}
action_recommendation: ${coerced.action_recommendation}
`;

      const scoreResp = await model.generateContent({ contents: [{ role: "user", parts: [{ text: rubricPrompt }] }] });
      let scoreText = extractJsonBlock(scoreResp.response.text().trim());
      let score: any = {};
      try { score = JSON.parse(scoreText); } catch { score = {}; }

      results.push({
        title: String(c?.title || `Case ${i + 1}`),
        scenario: { transcript: c?.transcript, visionHints: c?.visionHints },
        output: coerced,
        rubric: {
          high_reasoning: Number(score?.high_reasoning ?? 0),
          chain_of_command: Number(score?.chain_of_command ?? 0),
          location_awareness: Number(score?.location_awareness ?? 0),
          social_interaction: Number(score?.social_interaction ?? 0),
          notes: String(score?.notes || ""),
        },
      });
    }

    const avgConfidence = results.length
      ? results.reduce((acc, r) => acc + (r.output.confidence || 0), 0) / results.length
      : 0;

    const avgRubric = results.length
      ? {
          high_reasoning: results.reduce((a, r) => a + (r?.rubric?.high_reasoning || 0), 0) / results.length,
          chain_of_command: results.reduce((a, r) => a + (r?.rubric?.chain_of_command || 0), 0) / results.length,
          location_awareness: results.reduce((a, r) => a + (r?.rubric?.location_awareness || 0), 0) / results.length,
          social_interaction: results.reduce((a, r) => a + (r?.rubric?.social_interaction || 0), 0) / results.length,
        }
      : { high_reasoning: 0, chain_of_command: 0, location_awareness: 0, social_interaction: 0 };

    return NextResponse.json({ count: results.length, avgConfidence, avgRubric, results });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
