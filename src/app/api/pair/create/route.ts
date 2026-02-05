import { NextResponse } from "next/server";
import { createSession } from "@/lib/pairStore";

export async function POST() {
  try {
    const s = createSession();
    return NextResponse.json({ sid: s.sid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
