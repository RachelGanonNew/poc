"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridge } from "../lib/glassesBridge";
import type { GlassesBridge, SensorSample } from "../lib/glassesBridge";
import UserJourneyStatus from "../components/UserJourneyStatus";

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
  const [sysInstr, setSysInstr] = useState<string>("");
  const [prefs, setPrefs] = useState<string>("{}");
  const [hist, setHist] = useState<string>("");
  const [savingCtx, setSavingCtx] = useState(false);
  const [analyzeOut, setAnalyzeOut] = useState<string>("");
  const [analyzeConfidence, setAnalyzeConfidence] = useState<number | null>(null);
  const [outputMode, setOutputMode] = useState<"text" | "voice">("text");
  const [privacyMode, setPrivacyMode] = useState<"off" | "local" | "cloud">("cloud");
  const speakRef = useRef<{ speak: (t: string) => void; cancel: () => void } | null>(null);
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
  const [runStatus, setRunStatus] = useState<string>("");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runElapsedSec, setRunElapsedSec] = useState<number>(0);
  const [autoRunGoal, setAutoRunGoal] = useState<boolean>(true);
  const [autoNotes, setAutoNotes] = useState<boolean>(true);
  const lastRunGoalEditRef = useRef<number>(0);
  const lastNotesEditRef = useRef<number>(0);
  const [audit, setAudit] = useState<{ session?: any; tasks?: any[]; verifySteps?: any[]; logs?: any[] } | null>(null);
  const [auditMsg, setAuditMsg] = useState<string>("");
  const [auditFilter, setAuditFilter] = useState<"all" | "pass" | "fail">("all");
  const [artifacts, setArtifacts] = useState<{ name: string; path: string }[]>([]);
  const coachLastRef = useRef<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [demoMode, setDemoMode] = useState<boolean>(false);
  const [appClosed, setAppClosed] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const suggestionBeforeDemoRef = useRef<string>("");
  const demoIntervalRef = useRef<number | null>(null);
  const [showDemo, setShowDemo] = useState<boolean>(false);
  const [showDetectionsSidebar, setShowDetectionsSidebar] = useState<boolean>(true);
  const [showAuditLink, setShowAuditLink] = useState<boolean>(true);
  const [healthMsg, setHealthMsg] = useState<string>("");
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

  const cardBase = "rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur";
  const cardTitleRow = "mb-4 flex items-start justify-between gap-3";
  const pillBase = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium";
  const primaryBtn = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900";
  const secondaryBtn = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50";

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

  const closeApp = useCallback(() => {
    try { teardown(); } catch {}
    try { fetch("/api/agent/stop", { method: "POST" }).catch(() => {}); } catch {}
    setConsented(false);
    setPaused(false);
    setDemoMode(false);
    setMobileSidebarOpen(false);
    setAppClosed(true);
  }, [teardown]);

  useEffect(() => {
    if (!consented || paused || demoMode || privacyMode === "off") return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetch("/api/agent/status");
        const j = await s.json().catch(() => ({}));
        if (!cancelled && !j?.active) {
          await fetch("/api/agent/start", { method: "POST" });
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [consented, paused, demoMode, privacyMode]);

  useEffect(() => {
    if (!consented || paused || demoMode || privacyMode === "off") return;
    if (!autoRunGoal && !autoNotes) return;
    let cancelled = false;

    const applyDraft = async () => {
      try {
        const s = await fetch("/api/agent/status");
        const sj = await s.json().catch(() => ({}));
        if (!sj?.active) {
          await fetch("/api/agent/start", { method: "POST" });
        }

        const r = await fetch("/api/agent/report");
        const j = await r.json();
        if (!r.ok) return;

        const risks: string[] = Array.isArray(j?.risks) ? j.risks : [];
        const actions: Array<{ title?: string; owner?: string; due?: string }> = Array.isArray(j?.actions) ? j.actions : [];
        const lastInsights = Array.isArray(j?.outline?.insights) ? j.outline.insights : [];

        const topRisk = risks[0] || "";
        const lastAction = actions[0]?.title ? String(actions[0].title) : "";
        const insightHint = lastInsights.length ? String(lastInsights[lastInsights.length - 1]?.observation || "") : "";

        const goalDraft = [
          "Stay aligned in the conversation.",
          topRisk ? `Mitigate: ${topRisk}.` : "",
          lastAction ? `End with: ${lastAction}.` : "",
        ].filter(Boolean).join(" ").slice(0, 140);

        const notesDraft = [
          topRisk ? `Risk: ${topRisk}` : "",
          insightHint ? `Signal: ${insightHint}` : "",
          actions.length
            ? "Follow-ups:\n" + actions.slice(0, 5).map((a) => `- ${String(a?.title || "").trim()}`).filter(Boolean).join("\n")
            : "",
        ].filter(Boolean).join("\n").slice(0, 1200);

        if (cancelled) return;

        if (autoRunGoal) setRunGoal(goalDraft);
        if (autoNotes) setNotes(notesDraft);
      } catch {}
    };

    applyDraft();
    const iv = window.setInterval(applyDraft, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [consented, paused, demoMode, privacyMode, autoRunGoal, autoNotes]);

  useEffect(() => {
    if (!runStartedAt) return;
    setRunElapsedSec(0);
    const iv = window.setInterval(() => {
      setRunElapsedSec(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(iv);
  }, [runStartedAt]);

  // Demo Mode: scripted showcase without requiring camera/mic
  useEffect(() => {
    if (demoMode) {
      suggestionBeforeDemoRef.current = suggestion;
      // Stop capture and polling in demo
      try { teardown(); } catch {}
      setConsented(false);
      setPaused(false);

      const demoTips = [
        "The Vibe: Friendly but a bit sarcastic.\nThe Hidden Meaning: They’re teasing, not literally criticizing.\nThe Social Script: What to say: ‘Haha fair—what would you do instead?’",
        "The Vibe: Tense and dismissive.\nThe Hidden Meaning: They may be signaling impatience.\nThe Social Script: What to say: ‘Got it—what’s the one thing you need from me right now?’",
        "The Vibe: Polite but condescending.\nThe Hidden Meaning: They’re testing boundaries.\nThe Social Script: What to say: ‘I want to help—please tell me what you’re expecting.’",
      ];

      const now = Date.now();
      setDetections([
        { t: now, kind: "Sarcasm likely", info: "Words and tone don’t match" },
        { t: now - 7000, kind: "Pressure", info: "Short replies, impatient tone" },
        { t: now - 14000, kind: "Condescending", info: "Overly polite wording" },
      ]);

      let i = 0;
      setSuggestion(demoTips[i]);
      if (demoIntervalRef.current) window.clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = window.setInterval(() => {
        i = (i + 1) % demoTips.length;
        setSuggestion(demoTips[i]);
      }, 6000);
      return;
    }

    if (demoIntervalRef.current) window.clearInterval(demoIntervalRef.current);
    demoIntervalRef.current = null;
    setDetections([]);
    if (suggestionBeforeDemoRef.current) setSuggestion(suggestionBeforeDemoRef.current);
  }, [demoMode, teardown]);

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
    if (!consented || paused || demoMode) return;
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
            if (outputMode !== "voice") return;
            if (now - (coachLastRef.current || 0) < 12000) return;
            coachLastRef.current = now;

            let msg = "";
            if (kind === "dominance") msg = "Invite others briefly, then summarize next steps.";
            else if (kind === "overlap") msg = "Quick pause. Offer the floor and clarify one speaker at a time.";
            else if (kind === "engagement_drop") msg = "Pulse check: ask one open question to re-engage.";
            if (!msg) return;

            speakRef.current?.speak(msg);
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

        // Stream mode is always ON in this build
        if (true) {
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
                    if (!cancelled && tip) setSuggestion(String(tip).slice(0, 700));
                    await reader.cancel();
                    return;
                  } catch {}
                }
              }
            }
          }
        }
      } catch {}
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [consented, paused, demoMode, levels.rms, levels.speaking, interruption, notes, outputMode]);

  // Load current backend context on component mount
  useEffect(() => {
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
  }, []);

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
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-slate-200 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      {appClosed && (
        <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6 py-10">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">App closed</h2>
            <p className="mt-1 text-sm text-slate-600">Camera, microphone, and background processing have been stopped.</p>
            <div className="mt-4 flex items-center gap-3">
              <button className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white" onClick={() => setAppClosed(false)}>
                Re-open
              </button>
            </div>
          </div>
        </div>
      )}

      {!appClosed && (
        <>
      {!consented && !demoMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 text-black shadow-xl dark:bg-zinc-900 dark:text-zinc-50">
            <h2 className="mb-2 text-2xl font-semibold">Enable AI Assist</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
              Camera and microphone will be used in real time. No raw media is stored. You can pause at any time.
            </p>
            <div className="flex gap-3">
              <button
                className="rounded-md bg-black px-4 py-2 text-white dark:bg-white dark:text-black"
                data-testid="consent-enable"
                onClick={async () => {
                  setConsented(true);
                  await start();
                }}
              >
                Enable
              </button>
              <button
                className="rounded-md border border-zinc-300 px-4 py-2 dark:border-zinc-700"
                onClick={closeApp}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 hidden h-screen border-r border-slate-200 bg-gradient-to-b from-white via-slate-50 to-slate-100 md:block ${sidebarOpen ? "w-72" : "w-14"}`}
      >
        <div className="flex h-full flex-col p-3">
          <div className="flex-1">
            {sidebarOpen && (
              <>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                <div className="mb-1 text-lg font-semibold tracking-tight text-slate-900">Settings</div>
                <div className="mb-4 text-xs text-slate-500">Control privacy, output, and device inputs.</div>
                <div className="space-y-4 text-sm">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-slate-700">Response format</span>
                    <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs shadow-sm" value={outputMode} onChange={async (e)=>{ const v = e.target.value as "text"|"voice"; setOutputMode(v); try { await fetch("/api/omnisense/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { outputMode: v } }) }); } catch {} }}>
                      <option value="text" className="text-gray-800">Text</option>
                      <option value="voice" className="text-gray-800">Voice</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-slate-700">Privacy</span>
                    <input type="checkbox" checked={privacyMode !== "off"} onChange={async (e)=>{ const v = e.target.checked ? "cloud" : "off"; setPrivacyMode(v as any); try { await fetch("/api/omnisense/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { privacyMode: v } }) }); } catch {} }} className="h-4 w-4 rounded-md border-2 border-indigo-400 bg-gradient-to-br from-indigo-500 to-purple-600" />
                  </label>
                  <button className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 ${glassesConnected ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-900"}`} onClick={()=>{ if (glassesConnected) setGlassesConnected(false); else setShowGlassesModal(true); }} title="Connect AI Glasses (simulated)">{glassesConnected?"Glasses Connected":"Connect Glasses"}</button>
                  <button className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50" onClick={closeApp}>Close App</button>
                </div>
              </div>

              {demoMode && (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                  <button className="w-full text-left text-sm font-semibold" onClick={()=>setShowDemo(v=>!v)}>
                    {showDemo ? "▼" : "►"} Demo settings
                  </button>
                  {showDemo && (
                    <div className="mt-3 space-y-3 text-sm">
                      <label className="flex items-center justify-between"><span>Show Detections</span><input type="checkbox" checked={showDetectionsSidebar} onChange={(e)=>setShowDetectionsSidebar(e.target.checked)} /></label>
                      <label className="flex items-center justify-between"><span>Show Audit Link</span><input type="checkbox" checked={showAuditLink} onChange={(e)=>setShowAuditLink(e.target.checked)} /></label>
                      <button className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50" onClick={async()=>{ try{ setHealthMsg("Checking..."); const r= await fetch('/api/health'); const j= await r.json(); setHealthMsg(r.ok? (j?.status||'OK') : 'error'); } catch { setHealthMsg('error'); } }}>
                        Check API Health
                      </button>
                      {showAuditLink && (
                        <a className="block rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50" href="/audit">Open Verification/Audit</a>
                      )}
                      {healthMsg && <div className="text-xs text-slate-500">{healthMsg}</div>}
                    </div>
                  )}
                </div>
              )}

              {showDetectionsSidebar && detections.length>0 && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <h3 className="mb-2 text-sm font-semibold">Recent Detections</h3>
                  <div className="flex flex-col gap-1 text-xs">
                    {detections.slice(0,5).map((d,i)=> (
                      <div key={`${d.t}-${i}`} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1">
                        <span className="truncate"><span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{d.kind}</span>{d.info||""}</span>
                        <span className="text-slate-500">{new Date(d.t).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </>
            )}
          </div>

          <button
            className="mt-2 flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white text-sm hover:bg-slate-50"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Collapse" : "Expand"}
          >
            {sidebarOpen ? "«" : "»"}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 overflow-auto bg-gradient-to-b from-white via-slate-50 to-slate-100 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">OmniSense</div>
              <button className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setMobileSidebarOpen(false)}>
                Close
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${consented && !paused ? "bg-emerald-500" : "bg-slate-400"}`} />
                <span className="text-xs text-slate-700">AI Assist {consented && !paused ? "ON" : "OFF"}</span>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
              <div className="mb-3 text-base font-semibold text-slate-900">Settings</div>
              <div className="space-y-4 text-sm">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">Response format</span>
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    value={outputMode}
                    onChange={async (e) => {
                      const v = e.target.value as "text" | "voice";
                      setOutputMode(v);
                      try {
                        await fetch("/api/omnisense/context", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ preferences: { outputMode: v } }),
                        });
                      } catch {}
                    }}
                  >
                    <option value="text" className="text-gray-800">Text</option>
                    <option value="voice" className="text-gray-800">Voice</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">Privacy</span>
                  <input
                    type="checkbox"
                    checked={privacyMode !== "off"}
                    onChange={async (e) => {
                      const v = e.target.checked ? "cloud" : "off";
                      setPrivacyMode(v as any);
                      try {
                        await fetch("/api/omnisense/context", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ preferences: { privacyMode: v } }),
                        });
                      } catch {}
                    }}
                    className="h-4 w-4 rounded-md border-2 border-purple-400 bg-gradient-to-br from-blue-500 to-purple-600"
                  />
                </label>

                <button
                  className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 ${
                    glassesConnected ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-900"
                  }`}
                  onClick={() => {
                    if (glassesConnected) setGlassesConnected(false);
                    else setShowGlassesModal(true);
                  }}
                >
                  {glassesConnected ? "Glasses Connected" : "Connect Glasses"}
                </button>
                <button className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50" onClick={closeApp}>
                  Close App
                </button>
              </div>
            </div>

            {demoMode && (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                <button className="w-full text-left text-sm font-semibold" onClick={() => setShowDemo((v) => !v)}>
                  {showDemo ? "▼" : "►"} Demo settings
                </button>
                {showDemo && (
                  <div className="mt-3 space-y-3 text-sm">
                    <label className="flex items-center justify-between"><span>Show Detections</span><input type="checkbox" checked={showDetectionsSidebar} onChange={(e)=>setShowDetectionsSidebar(e.target.checked)} /></label>
                    <label className="flex items-center justify-between"><span>Show Audit Link</span><input type="checkbox" checked={showAuditLink} onChange={(e)=>setShowAuditLink(e.target.checked)} /></label>
                    <button className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50" onClick={async()=>{ try{ setHealthMsg("Checking..."); const r= await fetch('/api/health'); const j= await r.json(); setHealthMsg(r.ok? (j?.status||'OK') : 'error'); } catch { setHealthMsg('error'); } }}>
                      Check API Health
                    </button>
                    {showAuditLink && (
                      <a className="block rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50" href="/audit">Open Verification/Audit</a>
                    )}
                    {healthMsg && <div className="text-xs text-slate-500">{healthMsg}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`transition-[padding-left] duration-200 md:pl-72 ${sidebarOpen ? "md:pl-72" : "md:pl-14"}`}>

      {/* Hero banner */}
      <div className="mx-auto w-full max-w-6xl px-6 pt-6">
        <div className="rounded-3xl border border-white/20 bg-gradient-to-r from-fuchsia-500 via-purple-600 to-indigo-600 p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">OmniSense</h1>
              <p className="mt-1 text-sm text-fuchsia-50/90">Real-time social insight, coaching, and follow-ups.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`${pillBase} border-white/30 bg-white/15 text-white`}> 
                <span className={`h-2 w-2 rounded-full ${consented && !paused ? "bg-emerald-300" : "bg-white/60"}`} />
                <span>{consented && !paused ? "AI Assist ON" : "AI Assist OFF"}</span>
              </div>
              <button className={`rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm ${demoMode ? "bg-emerald-600 hover:bg-emerald-500" : "bg-white/15 hover:bg-white/25"}`} onClick={()=>{ setAppClosed(false); setDemoMode(v=>!v); }}>
                {demoMode ? "Demo: ON" : "Demo"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm shadow-sm hover:bg-slate-50 md:hidden" onClick={() => setMobileSidebarOpen(true)}>
            ≡
          </button>
          <div className={`${pillBase} ${privacyMode === "off" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700"}`}>
            <span className={`h-2 w-2 rounded-full ${privacyMode === "off" ? "bg-amber-500" : "bg-emerald-500"}`} />
            <span>{privacyMode === "off" ? "Privacy off" : "Cloud enabled"}</span>
          </div>
          <div className={`${pillBase} border-slate-200 bg-white text-slate-700`}>
            <span className="text-slate-500">Format</span>
            <span className="font-semibold text-slate-900">{outputMode === "voice" ? "Voice" : "Text"}</span>
          </div>
        </div>
        {!sidebarOpen && (
          <div className="hidden items-center gap-2 md:flex">
            <button className={secondaryBtn} onClick={() => setSidebarOpen(true)}>
              Settings
            </button>
          </div>
        )}
      </header>

      <main className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-6 pb-12 md:grid-cols-12">
        {/* User Journey Status */}
        <div className="md:col-span-12">
          <UserJourneyStatus
            consented={consented}
            paused={paused}
            outputMode={outputMode}
            privacyMode={privacyMode}
            speakingSeconds={speakingSeconds}
            intensityPct={intensityPct}
          />
        </div>

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

        <section className={`md:col-span-3 ${cardBase}`}>
          <div className={cardTitleRow}>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Session</h3>
              <div className="mt-1 text-xs text-slate-500">Live signals and device status.</div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Speaking</span>
              <span className="font-semibold text-slate-900">{speakingSeconds}s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Intensity</span>
              <span className="font-semibold text-slate-900">{intensityPct}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Engagement</span>
              <span className="font-semibold text-slate-900">{engagement}</span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold text-slate-700">Sensors</div>
              <div className="space-y-1 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Head motion</span>
                  <span className="font-medium text-slate-900">{sensorSample?.headMotion || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Brightness</span>
                  <span className="font-medium text-slate-900">{typeof sensorSample?.brightness === "number" ? sensorSample.brightness : "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Temp</span>
                  <span className="font-medium text-slate-900">{typeof sensorSample?.temp === "number" ? sensorSample.temp : "-"}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">Glasses</div>
              <div className={`text-xs font-semibold ${glassesConnected ? "text-emerald-700" : "text-slate-500"}`}>
                {reconnecting ? "Reconnecting…" : glassesConnected ? "Connected" : "Not connected"}
              </div>
            </div>
          </div>
        </section>

        {/* Live Suggestions only; camera runs in background */}
        <section className={`md:col-span-9 ${cardBase}`}>
          <div className={cardTitleRow}>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Live Suggestions</h3>
              <div className="mt-1 text-xs text-slate-500">Short, actionable coaching as context updates.</div>
            </div>
            <div className="flex items-center gap-2">
              {demoMode && <div className={`${pillBase} border-slate-200 bg-slate-50 text-slate-700`}>Demo</div>}
              {interruption && <div className={`${pillBase} border-amber-200 bg-amber-50 text-amber-800`}>Interruption</div>}
            </div>
          </div>
          {demoMode && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="mb-2 text-xs font-medium text-slate-600">Demo video</div>
              <video
                className="h-44 w-full rounded bg-black object-cover"
                controls
                playsInline
                src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
              />
            </div>
          )}
          <div className="whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm leading-relaxed text-slate-800">
            {suggestion}
          </div>
          <video ref={videoRef} className="hidden h-[1px] w-[1px]" muted playsInline />
        </section>

        

        <section className={`md:col-span-12 ${cardBase}`}>
          <div className={cardTitleRow}>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Planner</h3>
              <div className="mt-1 text-xs text-slate-500">Draft a goal and execute when you’re ready.</div>
            </div>
            <div className={`${pillBase} ${autoRunGoal ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700"}`}>
              <span>{autoRunGoal ? "Auto" : "Manual"}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
              placeholder="Goal (e.g., Prepare follow-up plan for the meeting)"
              value={runGoal}
              onChange={(e) => {
                lastRunGoalEditRef.current = Date.now();
                setAutoRunGoal(false);
                const next = e.target.value;
                setRunGoal(next);
                if (!next.trim()) {
                  setRunResult("");
                  setRunStatus("");
                  setRunStartedAt(null);
                }
              }}
            />
            {!autoRunGoal && (
              <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50" onClick={() => setAutoRunGoal(true)}>
                Resume auto
              </button>
            )}
            <button
              className={primaryBtn}
              disabled={!runGoal.trim()}
              onClick={async () => {
                const goal = runGoal.trim();
                if (!goal) return;
                setRunGoal("");
                setAutoRunGoal(false);
                setRunResult("");
                setRunStatus("Running...");
                setRunStartedAt(Date.now());
                try {
                  const res = await fetch("/api/agent/run", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ goal, steps: 3, maxToolsPerStep: 2 }),
                  });
                  let json: any = null;
                  try {
                    json = await res.json();
                  } catch {
                    json = null;
                  }
                  if (!res.ok) {
                    const msg = String(json?.detail || json?.error || res.statusText || "failed");
                    throw new Error(`${msg} (HTTP ${res.status})`);
                  }
                  const final = json?.final ? String(json.final) : "";
                  setRunResult(final || `ok: steps=${json.steps}`);
                  setRunStatus("");
                  setRunStartedAt(null);
                } catch (e: any) {
                  setRunStatus("");
                  setRunStartedAt(null);
                  setRunResult(`error: ${e?.message || String(e)}`);
                }
              }}
            >
              Run
            </button>
          </div>
          {runStatus && <div className="text-xs text-slate-500">{runStatus} (elapsed {runElapsedSec}s, ETA ~10–30s)</div>}
          {runResult && <div className="whitespace-pre-line text-xs text-slate-500">{runResult}</div>}
        </section>

        {/* Verification/Audit removed from Home (kept for Demo Mode link elsewhere) */}

        <section className={`md:col-span-12 ${cardBase}`}>
          <div className={cardTitleRow}>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Follow‑ups</h3>
              <div className="mt-1 text-xs text-slate-500">Auto-drafted notes you can edit and execute.</div>
            </div>
            <div className={`${pillBase} ${autoNotes ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700"}`}>
              <span>{autoNotes ? "Auto" : "Manual"}</span>
            </div>
          </div>
          <textarea
            className="w-full min-h-32 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-300"
            placeholder="Paste brief meeting notes (or type key commitments)..."
            value={notes}
            onChange={(e) => {
              lastNotesEditRef.current = Date.now();
              setAutoNotes(false);
              setNotes(e.target.value);
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            {!autoNotes && (
              <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50" onClick={() => setAutoNotes(true)}>
                Resume auto
              </button>
            )}
            <button
              className={primaryBtn}
              onClick={extractActions}
              disabled={!notes.trim() || extracting}
            >
              {extracting ? "Extracting..." : "Extract Actions"}
            </button>
            {summary && <span className="text-xs text-slate-500">Summary ready</span>}
          </div>

          {summary && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm">
              <div className="mb-1 font-medium">Summary</div>
              <div className="text-slate-700">{summary}</div>
            </div>
          )}

          {actions.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="font-medium">Actions</div>
              {actions.map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <div>
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-slate-500">
                      {a.type}
                      {a.owner ? ` • ${a.owner}` : ""}
                      {a.due ? ` • due ${a.due}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.type === "calendar" && (
                      <a
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50"
                        href={calendarDraftUrl(a.title, a.date, a.time)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Calendar Draft
                      </a>
                    )}
                    {a.type === "task" && (
                      <button
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50"
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

      </main>
      </div>
        </>
      )}
    </div>
  );
}
