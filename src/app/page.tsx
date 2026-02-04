"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridge } from "../lib/glassesBridge";
import type { GlassesBridge, SensorSample } from "../lib/glassesBridge";
import { createLiveVoice } from "../lib/liveVoice";

type Levels = {
  rms: number;
  speaking: boolean;
};

export default function Home() {
  const [consented, setConsented] = useState(false);
  const [paused, setPaused] = useState(false);
  const [levels, setLevels] = useState<Levels>({ rms: 0, speaking: false });
  const [speakingMs, setSpeakingMs] = useState(0);
  const [interruption, setInterruption] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string>(
    "Stay concise. Invite others to weigh in. Clarify owners and dates."
  );
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState<string>("");
  const [actions, setActions] = useState<Array<any>>([]);
  const [extracting, setExtracting] = useState(false);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [useStream, setUseStream] = useState(false);
  const [sysInstr, setSysInstr] = useState<string>("");
  const [prefs, setPrefs] = useState<string>("{}");
  const [hist, setHist] = useState<string>("");
  const [savingCtx, setSavingCtx] = useState(false);
  const [analyzeOut, setAnalyzeOut] = useState<string>("");
  const [analyzeConfidence, setAnalyzeConfidence] = useState<number | null>(null);
  const [outputMode, setOutputMode] = useState<"text" | "voice">("text");
  const [privacyMode, setPrivacyMode] = useState<"off" | "local" | "cloud">("cloud");
  const [convMode, setConvMode] = useState(false);
  const speakRef = useRef<{ speak: (t: string) => void; cancel: () => void } | null>(null);
  const liveRef = useRef<ReturnType<typeof createLiveVoice> | null>(null);
  const [glassesConnected, setGlassesConnected] = useState(false);
  const [showGlassesModal, setShowGlassesModal] = useState(false);
  const [bridgeKind, setBridgeKind] = useState<"simulated" | "vendorX">("simulated");
  const [sensorSample, setSensorSample] = useState<{ headMotion?: string; brightness?: number; temp?: number } | null>(null);
  const sensorRef = useRef<{ headMotion?: string; brightness?: number; temp?: number } | null>(null);
  const lastSensorTsRef = useRef<number>(0);
  const backoffRef = useRef<number>(500);
  const engageBufRef = useRef<string[]>([]);
  const [engagement, setEngagement] = useState<string>("-");
  const stableEngagementRef = useRef<string>("-");
  const [reconnecting, setReconnecting] = useState(false);
  const detectBufRef = useRef<{ t: number; speaking: boolean; intensity: number; engagement: string }[]>([]);
  const lastEmitRef = useRef<Record<string, number>>({});
  const [detections, setDetections] = useState<{ t: number; kind: string; info?: string }[]>([]);
  const [runGoal, setRunGoal] = useState("");
  const [runResult, setRunResult] = useState<string>("");
  const [audit, setAudit] = useState<{ session?: any; tasks?: any[]; verifySteps?: any[]; logs?: any[] } | null>(null);
  const [auditMsg, setAuditMsg] = useState<string>("");
  const [auditFilter, setAuditFilter] = useState<"all" | "pass" | "fail">("all");
  const [artifacts, setArtifacts] = useState<{ name: string; path: string }[]>([]);
  const coachLastRef = useRef<number>(0);
  const [judgeMsg, setJudgeMsg] = useState<string>("");
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const lastSpeakingRef = useRef<boolean>(false);
  const lastRmsRef = useRef<number>(0);
  const startedAtRef = useRef<number | null>(null);
  const bridgeRef = useRef<GlassesBridge | null>(null);

  const speakingThreshold = 0.06; // heuristic
  const spikeFactor = 2.2; // interruption heuristic

  const stopAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (analyserRef.current) analyserRef.current.disconnect();
    analyserRef.current = null;
    if (audioCtxRef.current) audioCtxRef.current.close();
    audioCtxRef.current = null;
  }, []);

  // Glasses bridge hookup (simulated for now)
  useEffect(() => {
    if (glassesConnected) {
      if (!bridgeRef.current) bridgeRef.current = createBridge(bridgeKind);
      bridgeRef.current.start((s: SensorSample) => {
        sensorRef.current = s;
        setSensorSample(s);
        lastSensorTsRef.current = Date.now();
        const hm = (s?.headMotion || "steady").toString();
        engageBufRef.current.push(hm);
        if (engageBufRef.current.length > 8) engageBufRef.current.shift();
        const counts = engageBufRef.current.reduce((acc: Record<string, number>, k: string) => {
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        let cue = "neutral";
        const nod = counts["nod"] || 0;
        const shake = counts["shake"] || 0;
        const steady = counts["steady"] || 0;
        if (nod >= 3 && nod > shake) cue = "agreeing";
        else if (shake >= 3 && shake > nod) cue = "disagreeing?";
        else if (steady >= 5) cue = "engaged";
        // Debounce engagement changes: require two consecutive cues
        if (stableEngagementRef.current === cue) {
          setEngagement(cue);
        } else {
          stableEngagementRef.current = cue;
        }
      });
    } else {
      bridgeRef.current?.stop();
      sensorRef.current = null;
      setSensorSample(null);
      lastSensorTsRef.current = 0;
      engageBufRef.current = [];
      setEngagement("-");
      stableEngagementRef.current = "-";
      setReconnecting(false);
    }
    return () => {
      bridgeRef.current?.stop();
    };
  }, [glassesConnected, bridgeKind]);

  // Heartbeat reconnect/backoff for glasses sensors
  useEffect(() => {
    if (!glassesConnected) return;
    let cancelled = false;
    const iv = setInterval(() => {
      if (cancelled) return;
      const now = Date.now();
      if (lastSensorTsRef.current && now - lastSensorTsRef.current > 3000) {
        setReconnecting(true);
        try { bridgeRef.current?.stop(); } catch {}
        try {
          bridgeRef.current = createBridge(bridgeKind);
          bridgeRef.current.start((s: SensorSample) => {
            sensorRef.current = s;
            setSensorSample(s);
            lastSensorTsRef.current = Date.now();
            setReconnecting(false);
          });
          backoffRef.current = Math.max(500, Math.min(4000, backoffRef.current + 500));
        } catch {}
      } else if (lastSensorTsRef.current) {
        backoffRef.current = Math.max(500, backoffRef.current - 200);
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [glassesConnected, bridgeKind]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopAudio();
    stopStream();
  }, [stopAudio, stopStream]);

  const tick = useCallback(() => {
    if (!analyserRef.current || !dataRef.current) return;
    // Use permissive casts to avoid TS lib.dom generics mismatch across versions
    (analyserRef.current as any).getByteTimeDomainData(dataRef.current as any);
    let sumSq = 0;
    for (let i = 0; i < dataRef.current.length; i++) {
      const v = (dataRef.current[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / dataRef.current.length);
    const speaking = rms > speakingThreshold;

    const prevSpeaking = lastSpeakingRef.current;
    const prevRms = lastRmsRef.current;
    setLevels({ rms, speaking });

    if (startedAtRef.current == null) startedAtRef.current = performance.now();
    const now = performance.now();

    if (!paused && speaking) {
      setSpeakingMs((ms) => ms + 1000 / 30);
    }

    if (!prevSpeaking && speaking && prevRms > 0 && rms / (prevRms + 1e-6) > spikeFactor) {
      setInterruption("Possible interruption detected");
      setTimeout(() => setInterruption(null), 1500);
    }

    lastSpeakingRef.current = speaking;
    lastRmsRef.current = rms;
    rafRef.current = requestAnimationFrame(tick);
  }, [paused]);

  // Poll or stream backend for concise suggestion (~1/sec)
  useEffect(() => {
    if (!consented || paused) return;
    let cancelled = false;
    const iv = setInterval(async () => {
      try {
        const payload = {
          audioDynamics: {
            intensityPct: Math.min(100, Math.round(levels.rms * 400)),
            speaking: levels.speaking,
            interruption: !!interruption,
          },
          visionHints: { scene: "meeting", sensors: sensorRef.current ? { ...sensorRef.current, engagement } : undefined },
          transcript: notes.slice(0, 220),
        };

        // --- Temporal detectors (windowed over ~20s) ---
        const nowTs = Date.now();
        detectBufRef.current.push({ t: nowTs, speaking: levels.speaking, intensity: levels.rms, engagement });
        // keep last 20 seconds
        detectBufRef.current = detectBufRef.current.filter((p) => nowTs - p.t <= 20000);
        const last10 = detectBufRef.current.filter((p) => nowTs - p.t <= 10000);
        const speakCount10 = last10.filter((p) => p.speaking).length;
        const avgRms10 = last10.length ? last10.reduce((a, c) => a + c.intensity, 0) / last10.length : 0;
        const engag8 = detectBufRef.current.filter((p) => nowTs - p.t <= 8000).map((p) => p.engagement);

        const cool = (k: string, ms: number) => {
          const last = lastEmitRef.current[k] || 0;
          return nowTs - last >= ms;
        };
        const mark = (k: string) => (lastEmitRef.current[k] = nowTs);
        const emit = async (kind: string, info?: string) => {
          setDetections((ds) => [{ t: nowTs, kind, info }, ...ds].slice(0, 8));
          try {
            await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, at: nowTs, details: { info } }) });
          } catch {}
          // Trigger autonomous agent step with concise observation
          try {
            const observation = {
              detection: { kind, info, at: nowTs },
              audio: { speaking: levels.speaking, rms: Number(levels.rms.toFixed(3)) },
              sensors: sensorRef.current ? { ...sensorRef.current, engagement } : { engagement },
              transcript: notes.slice(0, 160),
            };
            await fetch("/api/agent/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation, maxTools: 2 }) });
          } catch {}

          // Real-time coaching (cooldown 12s) only when allowed
          try {
            const now = Date.now();
            if (privacyMode !== "cloud") return;
            if (!(convMode || outputMode === "voice")) return;
            if (now - (coachLastRef.current || 0) < 12000) return;
            coachLastRef.current = now;

            let msg = "";
            if (kind === "dominance") msg = "Invite others briefly, then summarize next steps.";
            else if (kind === "overlap") msg = "Quick pause. Offer the floor and clarify one speaker at a time.";
            else if (kind === "engagement_drop") msg = "Pulse check: ask one open question to re-engage.";
            if (!msg) return;

            // Prefer Live if available, else TTS
            if (liveRef.current) await liveRef.current.say(msg).catch(() => {});
            else speakRef.current?.speak(msg);
          } catch {}
        };

        // Dominance: speaking most of last 10s with higher average intensity
        if (speakCount10 >= 8 && avgRms10 > 0.08 && cool("dominance", 30000)) {
          mark("dominance");
          await emit("dominance", `Speaking ${speakCount10}/10s, avgRMS ${avgRms10.toFixed(3)}`);
        }
        // Overlap: reuse interruption heuristic as a proxy
        if (payload.audioDynamics.interruption && cool("overlap", 20000)) {
          mark("overlap");
          await emit("overlap", "Spike suggests speaking overlap/interruption");
        }
        // Engagement drop: sustained non-engaged cues
        const disengaged = engag8.filter((e) => e === "disagreeing?" || e === "-").length;
        if (disengaged >= 6 && cool("engagement_drop", 45000)) {
          mark("engagement_drop");
          await emit("engagement_drop", `Low engagement ${disengaged}/8s`);
        }

        if (useStream) {
          const res = await fetch("/api/omnisense/analyze/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok || !res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const chunks = buf.split("\n\n");
            for (const chunk of chunks) {
              if (chunk.includes("event: insight") && chunk.includes("data:")) {
                const line = chunk.split("\n").find((l) => l.startsWith("data:"));
                if (line) {
                  const json = line.slice(5).trim();
                  try {
                    const obj = JSON.parse(json);
                    const tip = obj?.action_recommendation || obj?.analysis || obj?.observation;
                    if (!cancelled && tip) setSuggestion(String(tip).slice(0, 180));
                    await reader.cancel();
                    return;
                  } catch {}
                }
              }
            }
          }
        } else {
          const res = await fetch("/api/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              intensityPct: payload.audioDynamics.intensityPct,
              speaking: payload.audioDynamics.speaking,
              interruption: payload.audioDynamics.interruption,
              sensors: sensorRef.current ? { ...sensorRef.current, engagement } : undefined,
            }),
          });
          if (!res.ok) return;
          const j = await res.json();
          if (!cancelled && j?.suggestion) {
            setSuggestion(j.suggestion);
            if (outputMode === "voice" && j?.suggestion) {
              speakRef.current?.speak(String(j.suggestion).slice(0, 180));
            }
          }
        }
      } catch {}
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [consented, paused, levels.rms, levels.speaking, interruption, useStream, notes, outputMode]);

  // Load current backend context when trainer opens
  useEffect(() => {
    if (!trainerOpen) return;
    (async () => {
      try {
        const res = await fetch("/api/omnisense/context");
        if (!res.ok) return;
        const j = await res.json();
        setSysInstr(j.systemInstruction || "");
        setPrefs(JSON.stringify(j.preferences || {}, null, 2));
        setHist(j.historySnippet || "");
        if (j?.preferences?.outputMode) setOutputMode(j.preferences.outputMode);
        if (j?.preferences?.privacyMode) setPrivacyMode(j.preferences.privacyMode);
      } catch {}
    })();
  }, [trainerOpen]);

  // Load preferences at app start for header toggles
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/omnisense/context");
        if (!res.ok) return;
        const j = await res.json();
        if (j?.preferences?.outputMode) setOutputMode(j.preferences.outputMode);
        if (j?.preferences?.privacyMode) setPrivacyMode(j.preferences.privacyMode);
      } catch {}
    })();
  }, []);

  const saveContext = async () => {
    try {
      setSavingCtx(true);
      const res = await fetch("/api/omnisense/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: sysInstr,
          preferences: JSON.parse(prefs || "{}"),
          historySnippet: hist,
        }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch (e) {
      alert("Failed to save context. Check preferences JSON.");
    } finally {
      setSavingCtx(false);
    }
  };

  const testAnalyze = async () => {
    try {
      const res = await fetch("/api/omnisense/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioDynamics: {
            intensityPct,
            speaking: levels.speaking,
            interruption: !!interruption,
          },
          visionHints: { scene: "meeting" },
          transcript: notes.slice(0, 400),
        }),
      });
      const j = await res.json();
      setAnalyzeOut(JSON.stringify(j, null, 2));
      if (typeof j?.confidence === "number") setAnalyzeConfidence(j.confidence);
    } catch {
      setAnalyzeOut("{\n  \"error\": \"analyze failed\"\n}");
    }
  };

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount) as any;
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.error(e);
    }
  }, [tick]);

  // Simple TTS helper when in voice mode
  useEffect(() => {
    speakRef.current = {
      speak: (t: string) => {
        try {
          if (typeof window === "undefined") return;
          if (!("speechSynthesis" in window)) return;
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(t);
          u.rate = 1.0;
          window.speechSynthesis.speak(u);
        } catch {}
      },
      cancel: () => {
        try { if (typeof window !== "undefined") window.speechSynthesis.cancel(); } catch {}
      }
    };
  }, []);

  // Live voice lifecycle (scaffold): start when Conversational Voice is enabled and privacy is cloud
  useEffect(() => {
    const shouldLive = convMode && privacyMode === "cloud";
    if (shouldLive) {
      if (!liveRef.current) liveRef.current = createLiveVoice({ model: process.env.NEXT_PUBLIC_GEMINI_MODEL || "gemini-3.0-pro" });
      liveRef.current.start().catch(() => {});
    } else {
      liveRef.current?.stop().catch(() => {});
      liveRef.current = null;
    }
    return () => {
      liveRef.current?.stop().catch(() => {});
      liveRef.current = null;
    };
  }, [convMode, privacyMode]);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  const speakingSeconds = useMemo(() => Math.round(speakingMs / 1000), [speakingMs]);
  const intensityPct = useMemo(() => Math.min(100, Math.round(levels.rms * 400)), [levels.rms]);

  const calendarDraftUrl = (title: string, date?: string, time?: string) => {
    // Build a simple Google Calendar event creation link
    // Dates should be in YYYYMMDD and optional time HHMM.
    const encode = encodeURIComponent;
    let datesParam = "";
    if (date) {
      const d = date.replaceAll("-", "");
      const t = (time || "0900").replaceAll(":", "");
      // 1 hour default duration
      datesParam = `&dates=${d}T${t}00/${d}T${(Number(t.slice(0,2))+1).toString().padStart(2,"0")}${t.slice(2)}00`;
    }
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encode(title)}${datesParam}`;
  };

  const extractActions = async () => {
    try {
      setExtracting(true);
      const res = await fetch("/api/extract-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notesText: notes }),
      });
      if (!res.ok) return;
      const j = await res.json();
      setSummary(j.summary || "");
      setActions(Array.isArray(j.actions) ? j.actions : []);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      {!consented && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 text-black shadow-xl dark:bg-zinc-900 dark:text-zinc-50">
            <h2 className="mb-2 text-2xl font-semibold">Enable AI Assist</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
              Camera and microphone will be used in real time. No raw media is stored. You can pause at any time.
            </p>
            <div className="flex gap-3">
              <button
                className="rounded-md bg-black px-4 py-2 text-white dark:bg-white dark:text-black"
                onClick={async () => {
                  setConsented(true);
                  await start();
                }}
              >
                Enable
              </button>
              <button
                className="rounded-md border border-zinc-300 px-4 py-2 dark:border-zinc-700"
                onClick={() => setConsented(false)}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className={`h-3 w-3 rounded-full ${consented && !paused ? "bg-emerald-500" : "bg-zinc-400"}`} />
          <span className="text-sm">AI Assist {consented && !paused ? "ON" : "OFF"}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            Output
            <select
              className="rounded border border-zinc-300 bg-transparent p-1 text-xs dark:border-zinc-700"
              value={outputMode}
              onChange={async (e) => {
                const v = e.target.value as "text" | "voice";
                setOutputMode(v);
                try {
                  await fetch("/api/omnisense/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { outputMode: v } }) });
                } catch {}
              }}
            >
              <option value="text">Text</option>
              <option value="voice">Voice</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={convMode}
              onChange={(e) => {
                const v = e.target.checked;
                setConvMode(v);
                if (v) {
                  setUseStream(true);
                  setOutputMode("voice");
                } else {
                  setUseStream(false);
                  setOutputMode("text");
                }
              }}
              disabled={privacyMode !== "cloud"}
            />
            Conversational Voice
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            Privacy
            <select
              className="rounded border border-zinc-300 bg-transparent p-1 text-xs dark:border-zinc-700"
              value={privacyMode}
              onChange={async (e) => {
                const v = e.target.value as "off" | "local" | "cloud";
                setPrivacyMode(v);
                try {
                  await fetch("/api/omnisense/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { privacyMode: v } }) });
                } catch {}
              }}
            >
              <option value="cloud">Cloud</option>
              <option value="local">Local</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={useStream} onChange={(e) => setUseStream(e.target.checked)} />
            Stream Mode
          </label>
          <button
            className={`rounded-md border px-3 py-1.5 text-sm ${glassesConnected ? "bg-emerald-600 text-white" : ""}`}
            onClick={() => {
              if (glassesConnected) {
                setGlassesConnected(false);
              } else {
                setShowGlassesModal(true);
              }
            }}
            title="Connect AI Glasses (simulated)"
          >
            {glassesConnected ? "Glasses: Connected" : "Connect Glasses"}
          </button>
          <button
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            onClick={() => setTrainerOpen((v) => !v)}
          >
            {trainerOpen ? "Close Trainer" : "Open Trainer"}
          </button>
          <button
            className="rounded-md border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400"
            title="One-click judge demo: run agent loop and export report"
            onClick={async () => {
              setJudgeMsg("Running judge demo...");
              try {
                const runRes = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: "Judge Demo: Prepare follow-up plan and assign owners", steps: 3, maxToolsPerStep: 2 }) });
                const runJson = await runRes.json();
                if (!runRes.ok) throw new Error(runJson?.error || "run failed");
                const repRes = await fetch("/api/audit/report", { method: "POST" });
                const repJson = await repRes.json();
                if (!repRes.ok) throw new Error(repJson?.error || "export failed");
                setJudgeMsg(`Demo complete. Report: ${repJson.artifact}`);
              } catch (e: any) {
                setJudgeMsg(`error: ${e?.message || String(e)}`);
              }
            }}
          >
            Start Judge Demo
          </button>
          {judgeMsg && <span className="text-xs text-emerald-700 dark:text-emerald-400">{judgeMsg}</span>}
          <button
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            onClick={() => {
              if (!consented) return;
              setPaused((p) => {
                const np = !p;
                if (np) {
                  stopAudio();
                  stopStream();
                } else {
                  start();
                }
                return np;
              });
            }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-6 pb-12 md:grid-cols-2">
        {showGlassesModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="w-full max-w-md rounded-xl bg-white p-5 text-black shadow-xl dark:bg-zinc-900 dark:text-zinc-50">
              <h3 className="mb-3 text-lg font-semibold">Connect AI Glasses</h3>
              <div className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
                Choose a device type to connect. Simulated adapter emits motion, light and temperature.
              </div>
              <label className="mb-4 block text-sm">
                Adapter
                <select
                  className="mt-1 w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
                  value={bridgeKind}
                  onChange={(e) => setBridgeKind(e.target.value as any)}
                >
                  <option value="simulated">Simulated</option>
                  <option value="vendorX">Vendor X (placeholder)</option>
                </select>
              </label>
              <div className="mt-4 flex items-center justify-end gap-3">
                <button className="rounded-md border px-3 py-1.5 text-sm dark:border-zinc-700" onClick={() => setShowGlassesModal(false)}>
                  Cancel
                </button>
                <button
                  className="rounded-md bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
                  onClick={() => {
                    setShowGlassesModal(false);
                    // This will trigger the bridge effect with selected kind
                    setGlassesConnected(true);
                  }}
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        )}
        <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <video ref={videoRef} className="h-[280px] w-full rounded-lg bg-black object-cover" muted playsInline />
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">Speaking intensity</div>
            <div className="h-3 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-3 rounded-full bg-emerald-500 transition-[width] duration-75"
                style={{ width: `${intensityPct}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">You spoke ~{speakingSeconds}s</div>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">Live Suggestions</h3>
          {interruption && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              {interruption}
            </div>
          )}
          <div className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            {suggestion}
          </div>
          {glassesConnected && sensorSample && (
            <div className="text-xs text-zinc-500">
              {reconnecting ? (
                <span className="text-amber-600">Glasses • reconnecting…</span>
              ) : (
                <>
                  Glasses • motion {String(sensorSample.headMotion || "-")} • light {sensorSample.brightness != null ? `${Math.round(sensorSample.brightness * 100)}%` : "-"} • temp {sensorSample.temp != null ? `${sensorSample.temp.toFixed(1)}°C` : "-"} • engagement {engagement}
                </>
              )}
            </div>
          )}

          <div className="mt-1 flex items-center gap-2">
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={async () => {
                try { await fetch("/api/agent/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ improved: true }) }); } catch {}
              }}
            >
              Helpful
            </button>
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={async () => {
                try { await fetch("/api/agent/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ falsePositive: true }) }); } catch {}
              }}
            >
              Not relevant
            </button>
          </div>

          <div className="mt-2 text-xs text-zinc-500">Suggestions update as audio dynamics change.</div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">Detections</h3>
          {detections.length === 0 ? (
            <div className="text-xs text-zinc-500">No recent detections.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {detections.map((d, i) => (
                <div key={`${d.t}-${i}`} className="flex items-center justify-between rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="inline-block rounded bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800">{d.kind}</span>
                    <span className="text-zinc-600 dark:text-zinc-400">{d.info || ""}</span>
                  </div>
                  <span className="text-zinc-500">{new Date(d.t).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">Autonomous Run</h3>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              placeholder="Goal (e.g., Prepare follow-up plan for the meeting)"
              value={runGoal}
              onChange={(e) => setRunGoal(e.target.value)}
            />
            <button
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              disabled={!runGoal.trim()}
              onClick={async () => {
                setRunResult("Running...");
                try {
                  const res = await fetch("/api/agent/run", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ goal: runGoal.trim(), steps: 3, maxToolsPerStep: 2 }),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "failed");
                  setRunResult(`ok: steps=${json.steps}, artifact=${json.artifact}`);
                } catch (e: any) {
                  setRunResult(`error: ${e?.message || String(e)}`);
                }
              }}
            >
              Run
            </button>
          </div>
          {runResult && <div className="text-xs text-zinc-600 dark:text-zinc-400">{runResult}</div>}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">Verification / Audit</h3>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={async () => {
                setAuditMsg("Loading timeline...");
                try {
                  const res = await fetch("/api/audit/timeline");
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "failed");
                  setAudit(json);
                  setAuditMsg("");
                } catch (e: any) {
                  setAuditMsg(`error: ${e?.message || String(e)}`);
                }
              }}
            >
              Refresh Timeline
            </button>
            <button
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
              onClick={async () => {
                setAuditMsg("Exporting...");
                try {
                  const res = await fetch("/api/audit/report", { method: "POST" });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "failed");
                  setAuditMsg(`Exported: ${json.artifact}`);
                } catch (e: any) {
                  setAuditMsg(`error: ${e?.message || String(e)}`);
                }
              }}
            >
              Export HTML Report
            </button>
            <button
              className="rounded-md border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400"
              title="Run a demo loop and export a report"
              onClick={async () => {
                setAuditMsg("Running demo...");
                try {
                  const runRes = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: "Prepare follow-up plan and assign owners", steps: 3, maxToolsPerStep: 2 }) });
                  const runJson = await runRes.json();
                  if (!runRes.ok) throw new Error(runJson?.error || "run failed");
                  const repRes = await fetch("/api/audit/report", { method: "POST" });
                  const repJson = await repRes.json();
                  if (!repRes.ok) throw new Error(repJson?.error || "export failed");
                  setAuditMsg(`Demo complete. Report: ${repJson.artifact}`);
                } catch (e: any) {
                  setAuditMsg(`error: ${e?.message || String(e)}`);
                }
              }}
            >
              Demo: Run + Export
            </button>
            {auditMsg && <div className="text-xs text-zinc-600 dark:text-zinc-400">{auditMsg}</div>}
          </div>
          {audit ? (
            <div className="flex flex-col gap-2 text-xs">
              <div className="text-zinc-600 dark:text-zinc-400">Tasks: {(audit.tasks || []).length} • Verify entries: {(audit.verifySteps || []).length} • Logs: {(audit.logs || []).length}</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px]">Filter:</span>
                <button className={`rounded border px-2 py-0.5 text-[11px] ${auditFilter === "all" ? "bg-zinc-200 dark:bg-zinc-800" : ""}`} onClick={() => setAuditFilter("all")}>All</button>
                <button className={`rounded border px-2 py-0.5 text-[11px] ${auditFilter === "pass" ? "bg-zinc-200 dark:bg-zinc-800" : ""}`} onClick={() => setAuditFilter("pass")}>PASS</button>
                <button className={`rounded border px-2 py-0.5 text-[11px] ${auditFilter === "fail" ? "bg-zinc-200 dark:bg-zinc-800" : ""}`} onClick={() => setAuditFilter("fail")}>FAIL</button>
              </div>
              <div className="flex flex-col gap-1">
                {(audit.verifySteps || [])
                  .filter((v:any)=> auditFilter === "all" ? true : (auditFilter === "pass" ? !!v.pass : v.pass === false))
                  .slice(-6)
                  .reverse()
                  .map((v:any, i:number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] dark:bg-zinc-800">{new Date((v.ts||Date.now())).toLocaleTimeString()}</span>
                    <span className={"text-[11px] font-medium " + (v.pass?"text-green-600":"text-red-500")}>{v.pass?"PASS":"FAIL"}</span>
                    <span className="text-zinc-600 dark:text-zinc-400">{String(v.claim||"").slice(0,120)}</span>
                  </div>
                ))}
              </div>
              {audit.session?.events && (
                <div className="mt-2">
                  <div className="mb-1 text-[11px] font-semibold">Recent Tool Calls</div>
                  <div className="flex flex-col gap-1">
                    {audit.session.events.slice(-8).reverse().map((ev:any, idx:number)=>{
                      const tc = ev?.data?.output?.toolCalls || [];
                      if (!tc.length) return null;
                      return (
                        <div key={idx} className="flex items-center gap-2 text-[11px]">
                          <span className="rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{new Date(ev.t).toLocaleTimeString()}</span>
                          <span className="text-zinc-600 dark:text-zinc-400">{tc.map((x:any)=>x.name).join(", ")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="mt-2">
                <div className="mb-1 text-[11px] font-semibold">Artifacts</div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] dark:border-zinc-700"
                    onClick={async ()=>{
                      try {
                        const res = await fetch("/api/audit/artifacts");
                        const j = await res.json();
                        if (res.ok) setArtifacts(j.items || []);
                      } catch {}
                    }}
                  >
                    Refresh
                  </button>
                  <div className="text-[11px] text-zinc-500">Shows local file paths</div>
                </div>
                <div className="mt-1 flex flex-col gap-1 text-[11px]">
                  {artifacts.length === 0 ? <div className="text-zinc-500">No artifacts yet.</div> : artifacts.slice(-10).reverse().map((a,i)=> (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.name}</span>
                      <span className="text-zinc-500 truncate max-w-[50%]" title={a.path}>{a.path}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-500">No timeline loaded yet.</div>
          )}
        </section>

        <section className="md:col-span-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-2 text-lg font-semibold">Commitments → Action Cards</h3>
          <textarea
            className="w-full min-h-28 rounded-md border border-zinc-300 bg-transparent p-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            placeholder="Paste brief meeting notes (or type key commitments)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-black"
              onClick={extractActions}
              disabled={!notes.trim() || extracting}
            >
              {extracting ? "Extracting..." : "Extract Actions"}
            </button>
            {summary && <span className="text-xs text-zinc-500">Summary ready</span>}
          </div>

          {summary && (
            <div className="mt-4 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="mb-1 font-medium">Summary</div>
              <div className="text-zinc-700 dark:text-zinc-300">{summary}</div>
            </div>
          )}

          {actions.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="font-medium">Actions</div>
              {actions.map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div>
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-zinc-500">
                      {a.type}
                      {a.owner ? ` • ${a.owner}` : ""}
                      {a.due ? ` • due ${a.due}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.type === "calendar" && (
                      <a
                        className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        href={calendarDraftUrl(a.title, a.date, a.time)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Calendar Draft
                      </a>
                    )}
                    {a.type === "task" && (
                      <button
                        className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => alert("Task added locally for demo")}
                      >
                        Add Task
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {trainerOpen && (
          <section className="md:col-span-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="mb-2 text-lg font-semibold">OmniSense Trainer</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium">System Instruction</div>
                <textarea
                  className="h-48 w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                  value={sysInstr}
                  onChange={(e) => setSysInstr(e.target.value)}
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">Preferences (JSON)</div>
                <textarea
                  className="h-48 w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm font-mono outline-none focus:border-zinc-500 dark:border-zinc-700"
                  value={prefs}
                  onChange={(e) => setPrefs(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-1 text-sm font-medium">History Snippet</div>
              <textarea
                className="h-20 w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                value={hist}
                onChange={(e) => setHist(e.target.value)}
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-black"
                onClick={saveContext}
                disabled={savingCtx}
              >
                {savingCtx ? "Saving..." : "Save Context"}
              </button>
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={testAnalyze}
              >
                Test Analyze
              </button>
            </div>
            {analyzeOut && (
              <>
              <div className="mt-4 mb-1 text-xs text-zinc-600 dark:text-zinc-300">
                {analyzeConfidence != null ? `Confidence: ${(analyzeConfidence * 100).toFixed(0)}%` : ""}
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
{analyzeOut}
              </pre>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
