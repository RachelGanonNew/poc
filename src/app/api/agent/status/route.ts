import { NextRequest, NextResponse } from "next/server";
import { agentGet } from "@/lib/agentStore";

export async function GET(_req: NextRequest) {
  const sess = agentGet();
  if (!sess) return NextResponse.json({ active: false });
  const { id, startedAt, endedAt, stats } = sess;
  const events = (sess.events || []).slice(-50);
  return NextResponse.json({ active: !endedAt, id, startedAt, endedAt, stats, events });
}
