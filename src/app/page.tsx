"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const speakRef = useRef<{ speak: (t: string) => void; cancel: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const lastSpeakingRef = useRef<boolean>(false);
  const lastRmsRef = useRef<number>(0);
  const startedAtRef = useRef<number | null>(null);

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
          visionHints: { scene: "meeting" },
          transcript: notes.slice(0, 220),
        };

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
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            onClick={() => setTrainerOpen((v) => !v)}
          >
            {trainerOpen ? "Close Trainer" : "Open Trainer"}
          </button>
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

          <div className="mt-2 text-xs text-zinc-500">Suggestions update as audio dynamics change.</div>
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
