import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { agentGet } from "@/lib/agentStore";
import { listTasks } from "@/lib/taskStore";
import { readRecentLogs } from "@/lib/log";

function escapeHtml(s: string) {
  return s.replace(/[&<>"]+/g, (c) => ({"&":"&amp;","<":"&lt;", ">":"&gt;","\"":"&quot;"}[c] as string));
}

export async function POST(req: NextRequest) {
  try {
    const session = agentGet();
    const tasks = listTasks();
    const logsRaw = readRecentLogs(200);
    const logs = logsRaw.map((l) => {
      try { return JSON.parse(l); } catch { return l; }
    });

    const verifyDir = path.join(process.cwd(), ".data", "verify");
    if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
    const stepsFile = path.join(verifyDir, "steps.jsonl");
    let verifySteps: any[] = [];
    if (fs.existsSync(stepsFile)) {
      const txt = fs.readFileSync(stepsFile, "utf8");
      verifySteps = txt.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return line; }
      });
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>OmniSense Audit Report</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b0b0b;color:#e5e5e5;padding:24px}
section{margin-bottom:24px} h1{font-size:20px;margin-bottom:8px} h2{font-size:16px;margin:16px 0 8px}
.box{border:1px solid #333;border-radius:10px;padding:12px;background:#111}
.row{display:flex;gap:8px;align-items:center}
.badge{display:inline-block;padding:2px 8px;border-radius:9999px;background:#222;border:1px solid #333}
.pass{color:#16a34a}.fail{color:#ef4444}</style>
</head><body>
<h1>OmniSense Audit Report</h1>
<section class="box"><h2>Session</h2><pre>${escapeHtml(JSON.stringify(session, null, 2))}</pre></section>
<section class="box"><h2>Tasks</h2><pre>${escapeHtml(JSON.stringify(tasks, null, 2))}</pre></section>
<section class="box"><h2>Verification Steps</h2>
${verifySteps.slice(-50).map((v:any)=>`<div class="row"><span class="badge">${new Date(v.ts||Date.now()).toLocaleString()}</span><span class="badge ${v.pass?"pass":"fail"}">${v.pass?"PASS":"FAIL"}</span><span>${escapeHtml(String(v.claim||""))}</span></div>${v.evidence?`<pre>${escapeHtml(String(v.evidence))}</pre>`:""}`).join("")}
</section>
<section class="box"><h2>Recent Logs</h2><pre>${escapeHtml(JSON.stringify(logs.slice(-100), null, 2))}</pre></section>
</body></html>`;

    const file = path.join(verifyDir, `audit_${Date.now()}.html`);
    fs.writeFileSync(file, html, { encoding: "utf8" });
    return NextResponse.json({ ok: true, artifact: file });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
