import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { agentGet } from "@/lib/agentStore";
import { listTasks } from "@/lib/taskStore";
import { readRecentLogs } from "@/lib/log";

export async function GET() {
  try {
    const session = agentGet();
    const tasks = listTasks();
    const logsRaw = readRecentLogs(300);
    const logs = logsRaw.map((l) => {
      try { return JSON.parse(l); } catch { return l; }
    });
    const verifyDir = path.join(process.cwd(), ".data", "verify");
    const stepsFile = path.join(verifyDir, "steps.jsonl");
    let verifySteps: any[] = [];
    if (fs.existsSync(stepsFile)) {
      const txt = fs.readFileSync(stepsFile, "utf8");
      verifySteps = txt.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return line; }
      });
    }
    return NextResponse.json({ session, tasks, logs, verifySteps });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
