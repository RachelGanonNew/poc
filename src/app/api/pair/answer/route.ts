import { NextRequest, NextResponse } from "next/server";
import { getSession, upsertSession } from "@/lib/pairStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sid, answer } = body || {};
    if (!sid || !answer) return NextResponse.json({ error: "missing" }, { status: 400 });
    const s = getSession(String(sid));
    if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
    (s as any).answer = answer;
    upsertSession(s);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
