import fs from "fs";
import path from "path";

export type Task = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  notes?: string;
  createdAt: number;
  updatedAt: number;
  logs?: Array<{ t: number; msg: string }>;
};

type Data = { tasks: Task[] };

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "tasks.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ tasks: [] }, null, 2));
}

function load(): Data {
  ensure();
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { tasks: [] }; }
}

function save(data: Data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }

export function listTasks(): Task[] {
  const d = load();
  return d.tasks;
}

export function createTask(title: string, notes?: string): Task {
  const d = load();
  const now = Date.now();
  const t: Task = { id: `t-${now}-${Math.floor(Math.random()*1e6)}` , title, status: "pending", notes, createdAt: now, updatedAt: now, logs: [] };
  d.tasks.push(t);
  save(d);
  return t;
}

export function updateTaskStatus(id: string, status: Task["status"], notes?: string): Task | null {
  const d = load();
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return null;
  t.status = status;
  if (notes) t.notes = notes;
  t.updatedAt = Date.now();
  save(d);
  return t;
}

export function logTask(id: string, msg: string) {
  const d = load();
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return;
  t.logs = t.logs || [];
  t.logs.push({ t: Date.now(), msg });
  t.updatedAt = Date.now();
  save(d);
}
