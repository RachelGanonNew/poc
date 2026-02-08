import fs from "fs";
import { dataPath } from "./dataDir";

export type InteractionEvent = {
  t: number;
  kind: string;
  input?: any;
  output?: any;
  meta?: any;
};

function safeJsonParse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function truncateText(s: string, max = 1200) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function sanitize(obj: any, depth = 0): any {
  if (obj == null) return obj;
  if (depth > 4) return undefined;
  if (typeof obj === "string") return truncateText(obj, 1200);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.slice(0, 24).map((x) => sanitize(x, depth + 1));
  if (typeof obj === "object") {
    const out: Record<string, any> = {};
    const entries = Object.entries(obj).slice(0, 40);
    for (const [k, v] of entries) out[k] = sanitize(v, depth + 1);
    return out;
  }
  return String(obj);
}

function isEnabled(preferences?: Record<string, any>) {
  if (process.env.LONG_MEMORY_DISABLED === "1") return false;
  const pref = preferences as any;
  if (pref && pref.enableMemory === false) return false;
  return true;
}

function upstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function upstashLpush(key: string, value: string) {
  const cfg = upstashConfig();
  if (!cfg) throw new Error("missing_upstash");
  const res = await fetch(`${cfg.url}/lpush/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([value]),
  });
  if (!res.ok) throw new Error(`upstash_lpush_${res.status}`);
}

async function upstashLtrim(key: string, start: number, stop: number) {
  const cfg = upstashConfig();
  if (!cfg) throw new Error("missing_upstash");
  const res = await fetch(`${cfg.url}/ltrim/${encodeURIComponent(key)}/${start}/${stop}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`upstash_ltrim_${res.status}`);
}

async function upstashLrange(key: string, start: number, stop: number) {
  const cfg = upstashConfig();
  if (!cfg) throw new Error("missing_upstash");
  const res = await fetch(`${cfg.url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`upstash_lrange_${res.status}`);
  const json: any = await res.json().catch(() => null);
  return Array.isArray(json?.result) ? (json.result as string[]) : [];
}

function filePath() {
  return dataPath("long_memory.jsonl");
}

export async function appendInteraction(
  kind: string,
  payload: { input?: any; output?: any; meta?: any; preferences?: Record<string, any> },
  opts: { key?: string; maxItems?: number } = {}
) {
  if (!isEnabled(payload.preferences)) return;
  const key = opts.key || "omni:long_memory:v1";
  const maxItems = Math.max(50, Math.min(2000, Number(opts.maxItems || 600)));

  const evt: InteractionEvent = {
    t: Date.now(),
    kind,
    input: sanitize(payload.input),
    output: sanitize(payload.output),
    meta: sanitize(payload.meta),
  };
  const line = JSON.stringify(evt);

  const cfg = upstashConfig();
  if (cfg) {
    try {
      await upstashLpush(key, line);
      await upstashLtrim(key, 0, maxItems - 1);
      return;
    } catch {
      // fall through to file
    }
  }

  try {
    const p = filePath();
    const dir = p.replace(/[\\/][^\\/]+$/, "");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(p, line + "\n", { encoding: "utf8" });
  } catch {}
}

export async function listRecentInteractions(
  opts: { key?: string; limit?: number; preferences?: Record<string, any> } = {}
): Promise<InteractionEvent[]> {
  if (!isEnabled(opts.preferences)) return [];
  const key = opts.key || "omni:long_memory:v1";
  const limit = Math.max(1, Math.min(200, Number(opts.limit || 40)));

  const cfg = upstashConfig();
  if (cfg) {
    try {
      const items = await upstashLrange(key, 0, limit - 1);
      return items
        .map((s) => safeJsonParse(s))
        .filter(Boolean)
        .map((x) => x as InteractionEvent);
    } catch {
      return [];
    }
  }

  try {
    const p = filePath();
    if (!fs.existsSync(p)) return [];
    const txt = fs.readFileSync(p, "utf8");
    const lines = txt.trim().split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-limit);
    return tail
      .map((s) => safeJsonParse(s))
      .filter(Boolean)
      .map((x) => x as InteractionEvent);
  } catch {
    return [];
  }
}

export async function buildLongMemorySnippet(opts: {
  preferences?: Record<string, any>;
  limit?: number;
  maxChars?: number;
}): Promise<string> {
  const limit = Math.max(1, Math.min(80, Number(opts.limit || 24)));
  const maxChars = Math.max(400, Math.min(6000, Number(opts.maxChars || 2200)));
  const items = await listRecentInteractions({ limit, preferences: opts.preferences });
  if (!items.length) return "";

  const lines = items
    .slice(0, limit)
    .map((e) => {
      const t = new Date(e.t).toISOString();
      const inTxt = e.input ? truncateText(JSON.stringify(e.input), 500) : "";
      const outTxt = e.output ? truncateText(JSON.stringify(e.output), 500) : "";
      return `- ${t} ${e.kind} in=${inTxt} out=${outTxt}`;
    });

  const txt = lines.join("\n");
  return txt.length > maxChars ? txt.slice(0, maxChars) + "…" : txt;
}
