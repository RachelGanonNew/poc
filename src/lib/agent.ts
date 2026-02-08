import { GoogleGenerativeAI } from "@google/generative-ai";
import { getOmniContext } from "./omnisenseStore";
import { agentAddEvent, agentGet } from "./agentStore";
import { toolsSchemaSummary, executeTool, ToolCall } from "./tools";
import { evaluatePolicies } from "./brain";
import { logJsonl } from "./log";
import { assembleLongContext } from "./context";
import { appendInteraction, buildLongMemorySnippet } from "./longMemory";

export type AgentStepInput = {
  observation: Record<string, any>;
  preferences?: Record<string, any>;
  maxTools?: number;
};

export type AgentStepOutput = {
  thoughts: string;
  toolCalls: Array<{ name: string; args: Record<string, any>; ok: boolean; result?: any; error?: string }>;
  final?: string;
  level?: 1 | 2 | 3;
  signature?: string;
};

export async function runAgentStep(input: AgentStepInput): Promise<AgentStepOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const demo: AgentStepOutput = { thoughts: "Demo: no API key present", toolCalls: [], final: "No-op" };
    agentAddEvent("system", { kind: "agent.step", details: demo });
    return demo;
  }
  const { systemInstruction, preferences: prefStore } = getOmniContext();
  const prefs = input.preferences || prefStore || {};

  const sess = agentGet();
  const stats = sess?.stats || {};

  const schema = toolsSchemaSummary();
  const modelName = process.env.GEMINI_MODEL || "gemini-3.0-pro";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const longCtx = assembleLongContext();
  const longMemory = await buildLongMemorySnippet({ preferences: prefs, limit: 24, maxChars: 2200 });
  const prompt = `${systemInstruction}

IMPORTANT: Ignore any output-format requirements above. Follow the OUTPUT CONTRACT below exactly.

ROLE: You are the Social Intelligence Interpreter.
Your purpose is to act as a real-time "Social Translator" for the user. You process multimodal context (audio/video cues + environment + history) to reveal what is actually being felt or intended.

ADAPTATION & MEMORY:
- Use LONG-TERM MEMORY to detect patterns over time (relationship dynamics, recurring triggers, preferred communication style).
- Incorporate cultural/communication-norm nuance only when evidence supports it; do not stereotype.
- Prefer emotionally intelligent phrasing (name feelings, validate, de-escalate) while staying direct.

PRINCIPLES:
- Subtext-first: contrast literal words vs likely intent.
- Detect sarcasm/irony from mismatches (tone, facial expression, timing) when evidence supports it.
- Be direct about social risk (manipulative/condescending cues) but do not insult.
- Do not infer protected traits or identity. Avoid biometric claims.
- Provide definitive, usable guidance (avoid "if this is your manager...").
- Keep language simple and speakable.

OUTPUT CONTRACT (STRICT): Return ONLY JSON with keys:
- thoughts: brief reasoning summary (concise; do not reveal private chain-of-thought)
- tool_calls: array of { name, args } from TOOLS below (may be empty)
- final: user-facing guidance in EXACTLY 4 short lines (total <= 180 chars):
  The Vibe: ...
  The Hidden Meaning: ...
  Social Red Flags: ...
  The Social Script: ...

TOOLS (JSON schema summary):\n${JSON.stringify(schema)}

INPUTS:
- Observation: ${JSON.stringify(input.observation)}
- Preferences: ${JSON.stringify(prefs)}
- Stats: ${JSON.stringify(stats)}
- LongContext: ${longCtx}
- LongTermMemory (recent interactions; may be empty):\n${longMemory || ""}
`;

  const started = Date.now();
  // Resilient call with retry/backoff
  async function callWithRetry(attempts = 3): Promise<string> {
    let delay = 250;
    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const resp = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
        return resp.response.text().trim();
      } catch (e: any) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 100)));
        delay = Math.min(2000, delay * 2);
      }
    }
    // Log failure and emit verification FAIL
    agentAddEvent("system", { kind: "agent.error", details: { where: "runAgentStep.generateContent", error: String(lastErr?.message || lastErr) } });
    try { await executeTool({ name: "agent.verify_step", args: { claim: "Model call failed after retries", evidence: "generateContent", pass: false } }); } catch {}
    // Return a user-facing explanation while keeping the run consistent.
    // Keep the 4-line contract so downstream UI stays stable.
    return JSON.stringify({
      thoughts: "Gemini API unreachable; returning fallback response.",
      tool_calls: [],
      final:
        "The Vibe: AI temporarily offline.\n" +
        "The Hidden Meaning: Gemini API call failed.\n" +
        "Social Red Flags: Check key/quota/network.\n" +
        "The Social Script: Retry; verify GEMINI_API_KEY.",
    });
  }

  let text = await callWithRetry(3);
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) text = text.slice(s, e + 1);
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch {
    parsed = { thoughts: text, tool_calls: [] };
  }

  const toolCalls: ToolCall[] = Array.isArray(parsed.tool_calls) ? parsed.tool_calls.slice(0, input.maxTools || 2) : [];
  logJsonl({ type: "agent_prompt", tokens_est: Math.ceil(prompt.length / 4), tool_calls: toolCalls.length });

  const executed: AgentStepOutput["toolCalls"] = [];
  for (const call of toolCalls) {
    const res = await executeTool({ name: String(call.name), args: call.args || {} });
    executed.push({ name: res.name, args: call.args || {}, ok: res.ok, result: res.result, error: res.error });
  }

  // Thought signature and level selection
  const okCount = executed.filter((e) => e.ok).length;
  let level: 1 | 2 | 3 = okCount > 0 ? 1 : 2; // escalate if nothing succeeded
  const signature = `obs:${Object.keys(input.observation||{}).slice(0,4).join(',')}|tools:${executed.map(e=>e.name).join('+')}|ok:${okCount}`;
  logJsonl({ type: "thought_signature", level, signature });

  // Basic self-check verification
  try {
    await executeTool({ name: "agent.verify_step", args: { claim: `Executed ${executed.length} tool(s) with ${okCount} success`, evidence: signature, pass: okCount > 0 } });
  } catch {}

  // Level 3 escalation: if Level 2 with attempted tools and no success, perform a cross-check and record escalation
  if (level === 2 && executed.length > 0 && okCount === 0) {
    level = 3;
    try {
      await executeTool({ name: "notes.write", args: { text: "Level 3 escalation: no successful tools; documenting uncertainty and requesting follow-up." } });
    } catch {}
    try {
      await executeTool({ name: "agent.event", args: { kind: "agent.level3", details: { signature, toolCalls: executed.map(e=>e.name) } } });
    } catch {}
    try {
      await executeTool({ name: "agent.verify_step", args: { claim: "Level 3 escalation executed (no successful tools)", evidence: signature, pass: false } });
    } catch {}
  }

  // Evaluate dynamic policies after tool execution (policy engine is tool-agnostic)
  try {
    const privacy = String((prefs as any)?.privacyMode || "cloud");
    await evaluatePolicies({ observation: input.observation || {}, privacy });
  } catch {}

  const out: AgentStepOutput = {
    thoughts: String(parsed.thoughts || ""),
    toolCalls: executed,
    final: parsed.final ? String(parsed.final) : undefined,
    level,
    signature,
  };

  agentAddEvent("system", { kind: "agent.step", ms: Date.now() - started, output: out });
  logJsonl({ type: "agent_step", ms: Date.now() - started, tools: executed.length });
  try {
    await appendInteraction(
      "agent.step",
      {
        input: { observation: input.observation, preferences: prefs },
        output: { thoughts: out.thoughts, final: out.final, level: out.level, signature: out.signature },
        meta: { tools: executed.map((t) => ({ name: t.name, ok: t.ok })) },
        preferences: prefs,
      },
      { maxItems: 800 }
    );
  } catch {}
  return out;
}
