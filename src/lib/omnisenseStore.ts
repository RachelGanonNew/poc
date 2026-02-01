import fs from "fs";
import path from "path";

type OmniContext = {
  systemInstruction: string;
  preferences?: Record<string, any>;
  historySnippet?: string; // short, safe-to-share text summary
};

const defaultSystemInstruction = `OmniSense Core Engine
Role: You are the OmniSense Core, a proactive multimodal intelligence engine designed for the Gemini 3 Action Era. You act as a "Cognitive Second Brain" for the user, processing real-time visual and auditory data to provide strategic, social, and logistical advantages.

Core Capabilities:
- Multimodal Synthesis: Analyze audio and video cues. Interpret intent and implications.
- Social Intelligence: Provide "Social Pilot" tactical advice using robust, ethical signals (turn-taking, tone, speaking balance). Avoid sensitive attribute inferences.
- Logistical Orchestration: Spot missing items, hazards, or inefficiencies.
- Long-Term Contextual Reasoning: Use provided summaries of preferences and prior notes.

Operational Guidelines:
- Be Proactive: Alert on tense moments or hazards.
- Reasoning: Verify conclusions before advising; avoid speculation.
- Action-Oriented: When a task is identified, output structured actions for external tools.

Output Format (strict JSON keys):
insight_type: (Social | Logistical | Safety | Strategic)
observation: brief description of what was detected
analysis: why it matters
action_recommendation: what to do now`;

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
