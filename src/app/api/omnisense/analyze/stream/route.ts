import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getOmniContext } from "@/lib/omnisenseStore";
import { appendInteraction, buildLongMemorySnippet } from "@/lib/longMemory";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  const { audioDynamics, visionHints, transcript, overrideSystemInstruction } = await req.json();
  const { systemInstruction, preferences, historySnippet } = getOmniContext();
  const system = overrideSystemInstruction || systemInstruction;
  const longMemory = await buildLongMemorySnippet({ preferences: preferences || {}, limit: 18, maxChars: 1600 });

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
`;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const resp = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        let text = resp.response.text().trim();
        const s = text.indexOf("{");
        const e = text.lastIndexOf("}");
        if (s >= 0 && e > s) text = text.slice(s, e + 1);
        // SSE format: data: <json>\n\n
        controller.enqueue(new TextEncoder().encode(`event: insight\n`));
        controller.enqueue(new TextEncoder().encode(`data: ${text}\n\n`));
        try {
          await appendInteraction(
            "omni.analyze.stream",
            {
              input: { audioDynamics, visionHints, transcript },
              output: { insight: text },
              meta: { privacy: preferences?.privacyMode || "cloud" },
              preferences: preferences || {},
            },
            { maxItems: 800 }
          );
        } catch {}
        controller.enqueue(new TextEncoder().encode(`event: done\n`));
        controller.enqueue(new TextEncoder().encode(`data: end\n\n`));
        controller.close();
      } catch (err) {
        controller.enqueue(new TextEncoder().encode(`event: error\n`));
        controller.enqueue(new TextEncoder().encode(`data: failed\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
