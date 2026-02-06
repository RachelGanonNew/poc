import fs from "fs";
import path from "path";

type OmniContext = {
  systemInstruction: string;
  preferences?: Record<string, any>;
  historySnippet?: string; // short, safe-to-share text summary
};

const defaultSystemInstruction = `Role: You are the Social Intelligence Interpreter.
Your purpose is to act as a real-time "Social Translator" for the user.
You process multimodal data (video/audio + context) to reveal what is actually being felt or intended, focusing on subtext, sarcasm, and non-verbal cues.

Subtext-First Analysis:
- Literal vs Intended: Contrast what was said with what they likely meant.
- Sarcasm Detection: Call out mismatches between words and tone.
- Non-verbal Cues: Mention body language or micro-expressions only as observable signals (avoid identity/biometrics claims).
- Context: Infer whether the situation is formal vs social from setting, clothing, and behavior.

Operational Guidelines:
- Human-readable output.
- Be direct about social risk (manipulative/condescending cues), but do not insult.
- Do not infer protected traits or identity.
- Prioritize accuracy and social safety.

Output Format (strict JSON keys):
insight_type: Social
observation: short
analysis: short
action_recommendation: MUST be 4 short lines:
The Vibe: ...
The Hidden Meaning: ...
Social Red Flags: ...
The Social Script: What to understand: ... What to say: ... What to do: ...`;

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "omni.json");

function ensureDir() {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch {}
}

function loadFromDisk(): OmniContext | null {
  try {
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, "utf8");
      const parsed = JSON.parse(raw);
      return parsed;
    }
  } catch {}
  return null;
}

function saveToDisk(ctx: OmniContext) {
  try {
    ensureDir();
    fs.writeFileSync(dataFile, JSON.stringify(ctx, null, 2), "utf8");
  } catch {}
}

let store: OmniContext =
  loadFromDisk() || {
    systemInstruction: defaultSystemInstruction,
    preferences: { privacyMode: "cloud", outputMode: "text", enableMemory: true },
    historySnippet: "",
  };

export function getOmniContext(): OmniContext {
  return store;
}

export function setOmniContext(partial: Partial<OmniContext>): OmniContext {
  if (partial.systemInstruction !== undefined) store.systemInstruction = partial.systemInstruction;
  if (partial.preferences !== undefined) store.preferences = partial.preferences;
  if (partial.historySnippet !== undefined) store.historySnippet = partial.historySnippet;
  saveToDisk(store);
  return store;
}
