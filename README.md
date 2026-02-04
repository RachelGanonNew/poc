# OmniSense Core

Proactive, privacy-first multimodal "Cognitive Second Brain" for meetings and safety, built for the Gemini 3 Hackathon.

## Setup
- Requirements: Node 18+, a Google Gemini API key.
- Create `.env.local` in project root:

```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.0-pro
```

## Run
- Dev: `npm run dev` → http://localhost:3000
- Prod build: `npm run build`
- Prod serve: `npm run start` → http://localhost:3000

## Key Screens
- Home: live mic/cam assist, speaking intensity, interruption nudge, suggestions, Trainer panel.
- Upload: extract frames from a video and get a structured JSON insight with Confidence.

## Endpoints
- POST `/api/omnisense/analyze` — live JSON insight with confidence.
- POST `/api/omnisense/analyze-frames` — frames + transcript → JSON insight with confidence.
- GET  `/api/omnisense/analyze/stream` — streaming demo of insight.
- GET/POST `/api/omnisense/context` — system instruction, preferences, history.
- POST `/api/extract-actions` — summarize notes to action items.
- POST `/api/suggest` — lightweight suggestions from audio dynamics.
- GET  `/api/evaluate` — synthetic scenarios for prompt QA.
- GET  `/api/local-video` — dev-only stream for `C:/Users/USER/Downloads/a.mp4`.
- GET  `/api/health` — liveness check.

## Evaluation & Prompt QA
- Open `/api/evaluate` to run synthetic cases and get average confidence.
- Tune Trainer system instruction/preferences and re-run to iterate.

## Privacy
- No raw audio/video persisted. Only brief context and settings stored in `.data/omni.json` for local use.
- Prompts instruct Gemini to avoid sensitive attribute inference or identity claims.

### Research Provider (Web Enrichment)
- Endpoint: `GET /api/research?name=Full%20Name`
- Behavior by privacy mode:
  - `off`: blocked (403), no web calls.
  - `local`: returns a local message; no outbound requests.
  - `cloud`: uses Google Custom Search if configured, else falls back to Wikipedia.
- Optional env vars to enable Google Search:
  - `GOOGLE_API_KEY=...`
  - `GOOGLE_CSE_ID=...`
  - Without these, Wikipedia summary is used.

## Security
- Basic per-IP rate limiting on analysis routes.
- Schema coercion for outputs; Gemini self-check for confidence.

## Optional Hybrid Mode: AI Glasses
- Toggle via the "Connect Glasses" button in the header.
- Adapters:
  - Simulated: emits `headMotion`, `brightness`, `temp` for demos.
  - Vendor X (placeholder): scaffolded adapter to wire a real SDK (Web Bluetooth/WebUSB/WebRTC).
- When connected, live suggestions include `visionHints.sensors` for richer context.
- A compact sensor debug line appears under Live Suggestions.
- Privacy applies as usual; avoid sending raw sensor data in `local` mode.

## Submission Checklist (Devpost)
- Public demo URL or interactive app: deploy to Vercel/Netlify and include link.
- ~3-minute demo video showcasing Upload, Trainer, and Live features.
- 200-word Gemini usage write-up: see `SUBMISSION.md`.
- Public code repository: this repo.
- License: MIT (see `LICENSE`).

## Deploy
- Vercel (recommended):
  - Create a new project from this repo.
  - Set Environment Variables: `GEMINI_API_KEY`, `GEMINI_MODEL`.
  - Deploy. Open the public URL and verify `/api/health`.
- Netlify:
  - Use included `netlify.toml` and Next.js plugin.
  - Set env vars as above.

## Judges’ Quick Path
1) Visit `/upload`, click "Load default", then Analyze → see insight + Confidence.
2) Paste notes in Home → Extract Actions.
3) Open Trainer, tweak system instruction → re-run `/api/evaluate`.

For a detailed overview and demo script, see `SUBMISSION.md`.

## Troubleshooting
- Privacy modes
  - Cloud: full features enabled.
  - Local: no outbound web/model calls; endpoints return local heuristics.
  - Off: analysis/research endpoints return 403.
- No API keys
  - Without `GEMINI_API_KEY`, analyze endpoints respond with safe demo insights for public demos.
  - Without `GOOGLE_API_KEY` and `GOOGLE_CSE_ID`, `/api/research` falls back to Wikipedia.
- Network/TLS issues
  - Ensure outbound HTTPS (443) to Google APIs is allowed (VPN/Firewall can block).
  - Retries/backoff/timeout are built in; transient errors usually resolve on retry.
  - If a corporate network blocks requests, try a hotspot or whitelist the app.

## Judge Guide: Why This Wins the Action Era

- **Orchestrator, not a prompt wrapper**
  - Server-side agent with structured tool calling, long-context assembly, verification artifacts, and audit timeline.
  - Multi-step runs with goals, tool execution, and self-checks.

- **Temporal reasoning and real-time coaching**
  - Client detectors (dominance, overlap, engagement drop) trigger agent actions and on-the-spot coaching.
  - Cooldowns, privacy controls, and voice output via Live/TTS.

- **Long-context continuity**
  - Session + logs + tasks merged into a compact long-context injected into prompts.
  - Rolling artifacts: tasks.json, notes.md, verify/*.jsonl, audit_*.html.

- **Verification and auditability**
  - Endpoints: /api/audit/timeline and /api/audit/report.
  - HTML audit report with PASS/FAIL entries, recent logs, and session summary.

## Quick Demo Script (5–7 minutes)

1. Start the app and enable AI Assist (mic/cam allowed).
2. Turn on Conversational Voice and set Privacy to Cloud.
3. Trigger detections:
   - Dominance: speak for ~10s; hear a concise coaching cue.
   - Overlap: create a quick loud spike; see detection + coaching.
4. Autonomous Run:
   - In the Autonomous Run panel, set goal: "Prepare follow-up plan and assign owners"; click Run.
   - After it completes, open Verification/Audit and Export HTML Report.
5. Show artifacts in `.data/verify/` and timeline counts in the panel.
6. (Optional) Use Extract Actions with a short note; show generated actions and calendar link.

## Criteria Mapping

- Action Era Orchestrator: tools registry, multi-step loops, verification artifacts.
- Long Context: assembled context injected every step with rolling summaries.
- Temporal Understanding: detectors feed actions + coaching.
- Verification/Audit: JSONL + HTML report; PASS/FAIL and artifacts.
- Privacy & Safety: modes (off/local/cloud), cooldowns, and no sensitive inferences.

## Deployment Notes

- Environment: set GEMINI_API_KEY (required), optionally GOOGLE_API_KEY and GOOGLE_CSE_ID.
- Build: `npm run build` then `npm run start`.
- Public demo: local-only features work without keys; full features require Cloud privacy mode and keys.

## Architecture (High Level)

```
Browser (Next.js App)
  ├─ Live mic/cam + temporal detectors (dominance/overlap/engagement)
  ├─ Conversational Voice (Live) + TTS fallback
  ├─ Panels: Detections • Autonomous Run • Verification/Audit
  └─ Calls APIs: /api/agent/act, /api/agent/run, /api/audit/*

Server (Next API Routes)
  ├─ Agent Orchestrator
  │   ├─ Build prompt with LongContext (session+logs+tasks)
  │   ├─ Gemini 3 Pro call → tool_calls JSON
  │   ├─ Execute Tools (function calling)
  │   │   ├─ tasks.create / tasks.update_status
  │   │   ├─ calendar.create_event • memory.write • notes.write
  │   │   └─ web.search (Google CSE / Wikipedia)
  │   ├─ Verification: agent.verify_step (JSONL + timeline)
  │   └─ Thought Signatures & Levels (L1/L2; L3 escalation when needed)
  ├─ Audit/Report: timeline, artifacts, latest report
  └─ Stores (./.data): agent.json, agent.log, tasks.json, notes.md, verify/*

Gemini 3 Pro (Google AI Studio)
  └─ Reasoning over large context; returns structured tool calls
```

Level 3 escalation: If tools are attempted but none succeed, the agent documents uncertainty, emits an escalation event, and records a failed verification step. This is visible in the audit timeline and HTML report.

