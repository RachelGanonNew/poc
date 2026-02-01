import fs from "fs";
import path from "path";

export type AgentEvent = {
  t: number;
  type: "insight" | "note" | "system";
  data: any;
};

export type AgentSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  events: AgentEvent[];
  stats?: { falsePositives?: number; improvements?: number };
};

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "agent.json");

let session: AgentSession | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function save() {
  try {
    ensureDir();
    const data = { session };
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      session = raw.session || null;
    }
  } catch {}
}
load();

export function agentStart(): AgentSession {
  session = { id: `sess-${Date.now()}`, startedAt: Date.now(), events: [], stats: { falsePositives: 0, improvements: 0 } };
  save();
  return session;
}

export function agentStop(): AgentSession | null {
  if (session) {
    session.endedAt = Date.now();
    save();
  }
  return session;
}

export function agentStatus(): AgentSession | null {
  return session;
}

export function agentAddEvent(type: AgentEvent["type"], data: any) {
  if (!session) return;
  session.events.push({ t: Date.now(), type, data });
  save();
}

export function agentGet(): AgentSession | null {
  return session;
}

export function agentFeedback(opts: { falsePositive?: boolean; improved?: boolean }) {
  if (!session) return;
  session.stats = session.stats || { falsePositives: 0, improvements: 0 };
  if (opts.falsePositive) session.stats.falsePositives = (session.stats.falsePositives || 0) + 1;
  if (opts.improved) session.stats.improvements = (session.stats.improvements || 0) + 1;
  save();
}
