import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/pairStore";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sid = searchParams.get("sid");
    if (!sid) return NextResponse.json({ error: "missing_sid" }, { status: 400 });
    const s = getSession(String(sid));
    if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ sid: s.sid, offer: s.offer || null, answer: s.answer || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
