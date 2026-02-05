import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { intent = "adaptive facilitation" } = body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    // Fallback skeleton when offline
    if (!apiKey) {
      const id = `pol_${Math.random().toString(36).slice(2,8)}`;
      const proposal = {
        id,
        intent: String(intent),
        triggers: { anyTrue: [{ path: "conflict_suspected" }] },
        actions: [{ name: "notes.write", args: { text: `Policy ${id}: ${String(intent)}` } }],
        safeguards: { cooldownMs: 300000, privacy: "cloud" },
        verify: { claim: `Policy ${id} executed` },
        ttlMs: 48 * 60 * 60 * 1000,
        priority: 1,
      };
      return NextResponse.json({ proposal, offline: true });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-3.0-pro" });

    const sys = `You author short-lived, safe, verifiable policies for a daily-assistant. Output JSON with keys: id,intent,triggers,actions,safeguards,verify,ttlMs,priority. Avoid medical or sensitive-inference scopes.`;
    const prompt = `${sys}\nIntent: ${intent}\nReturn ONLY JSON.`;

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
      // Fallback skeleton proposal
      const id = `pol_${Math.random().toString(36).slice(2,8)}`;
      return JSON.stringify({ id, intent: String(intent), triggers: { anyTrue: [{ path: "conflict_suspected" }] }, actions: [{ name: "notes.write", args: { text: `Policy ${id}: ${String(intent)}` } }], safeguards: { cooldownMs: 300000, privacy: "cloud" }, verify: { claim: `Policy ${id} executed` }, ttlMs: 24*60*60*1000, priority: 1 });
    }

    let text = await callWithRetry(3);
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) text = text.slice(s, e + 1);
    let proposal: any = {};
    try { proposal = JSON.parse(text); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

    // Ensure required fields
    if (!proposal.id) proposal.id = `pol_${Math.random().toString(36).slice(2,8)}`;
    if (!proposal.intent) proposal.intent = String(intent);
    if (proposal.ttlMs == null) proposal.ttlMs = 24 * 60 * 60 * 1000;
    if (proposal.priority == null) proposal.priority = 0;

    return NextResponse.json({ proposal, offline: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
