import fs from "fs";
import path from "path";

export type PairState = {
  sid: string;
  offer?: any;
  answer?: any;
  offerCandidates?: any[];
  answerCandidates?: any[];
  createdAt: number;
  updatedAt: number;
};

function dataFile() {
  const p = path.join(process.cwd(), ".data", "pair-sessions.json");
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, "{}", { encoding: "utf8" });
  return p;
}

function loadMap(): Record<string, PairState> {
  try {
    const raw = fs.readFileSync(dataFile(), "utf8") || "{}";
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveMap(m: Record<string, PairState>) {
  fs.writeFileSync(dataFile(), JSON.stringify(m, null, 2));
}

export function createSession(): PairState {
  const sid = `s_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const state: PairState = { sid, createdAt: now, updatedAt: now } as any;
  const m = loadMap();
  m[sid] = state;
  saveMap(m);
  return state;
}

export function getSession(sid: string): PairState | undefined {
  const m = loadMap();
  return m[sid];
}

export function upsertSession(s: PairState) {
  const m = loadMap();
  s.updatedAt = Date.now();
  m[s.sid] = s;
  saveMap(m);
}
