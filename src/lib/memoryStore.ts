import fs from "fs";
import path from "path";

export type PersonMemory = {
  name: string;
  notes?: string[];
  seenCount: number;
  lastSeenAt?: number;
  extra?: Record<string, any>;
};

export type MemoryDB = {
  people: Record<string, PersonMemory>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "memory.json");

let db: MemoryDB = { people: {} };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch {}
}

(function load() {
  try {
    if (fs.existsSync(FILE)) {
      db = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    }
  } catch {}
})();

export function addPersonSeen(name: string, note?: string, extra?: Record<string, any>) {
  const key = name.trim().toLowerCase();
  if (!key) return;
  const pm = db.people[key] || { name, seenCount: 0, notes: [] };
  pm.seenCount += 1;
  pm.lastSeenAt = Date.now();
  if (note) pm.notes?.push(note);
  if (extra) pm.extra = { ...(pm.extra || {}), ...extra };
  db.people[key] = pm;
  save();
}

export function getMemory(): MemoryDB {
  return db;
}
