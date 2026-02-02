import { NextRequest, NextResponse } from "next/server";
import { agentAddEvent } from "@/lib/agentStore";

// POST /api/events
// { kind: string; at?: number; details?: any }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "").trim();
    if (!kind) return NextResponse.json({ error: "missing_kind" }, { status: 400 });
    const evt = { detection: { kind, at: body?.at || Date.now(), details: body?.details || {} } };
    agentAddEvent("system", evt);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
