import { NextRequest, NextResponse } from "next/server";
import { agentFeedback } from "@/lib/agentStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { falsePositive, improved } = body || {};
    agentFeedback({ falsePositive: !!falsePositive, improved: !!improved });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
