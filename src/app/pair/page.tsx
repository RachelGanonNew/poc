"use client";
import { useEffect, useMemo, useRef, useState } from "react";

function getIceServers() {
  try {
    const raw = process.env.NEXT_PUBLIC_ICE_SERVERS || "";
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as RTCIceServer[];
  } catch {}
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export default function PairPage() {
  const [sid, setSid] = useState<string>("");
  const [role, setRole] = useState<"desktop" | "phone">("desktop");
  const [status, setStatus] = useState<string>("");
  const [iceInfo, setIceInfo] = useState<string>("");
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [link, setLink] = useState<string>("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const qsid = url.searchParams.get("sid");
    const qrole = url.searchParams.get("role") as any;
    if (qsid) setSid(qsid);
    if (qrole === "phone") setRole("phone");
  }, []);

  const iceServers = useMemo(() => getIceServers(), []);

  useEffect(() => {
    if (sid) setLink(`${window.location.origin}/pair?sid=${encodeURIComponent(sid)}&role=phone`);
  }, [sid]);

  async function createSession() {
    setStatus("Creating session...");
    const res = await fetch("/api/pair/create", { method: "POST" });
    const j = await res.json();
    if (!res.ok) { setStatus(j?.error || "create failed"); return; }
    setSid(j.sid);
    setStatus("Session created.");
  }

  function waitGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const h = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", h);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", h);
    });
  }

  async function startDesktop() {
    if (!sid) { setStatus("Create session first"); return; }
    setStatus("Starting desktop peer...");
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate && e.candidate.type) {
        setIceInfo((s) => s || (e.candidate.type === "relay" ? "relayed" : "non-relay"));
      }
    });
    pc.addEventListener("track", (ev) => {
      const stream = ev.streams?.[0] || new MediaStream([ev.track]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(()=>{});
      }
    });
    // Receive-only video from phone
    pc.addTransceiver("video", { direction: "recvonly" });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitGathering(pc);
    await fetch("/api/pair/offer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid, offer: pc.localDescription }) });
    setStatus("Offer sent. Waiting for answer...");
    // Poll for answer
    let tries = 0;
    const poll = async () => {
      tries++;
      const res = await fetch(`/api/pair/state?sid=${encodeURIComponent(sid)}`);
      const j = await res.json();
      if (j?.answer?.type === "answer") {
        await pc.setRemoteDescription(j.answer);
        setStatus("Connected (answer set)");
        return;
      }
      if (tries < 60) setTimeout(poll, 1000);
      else setStatus("Timeout waiting for answer");
    };
    poll();
  }

  async function startPhone() {
    if (!sid) { setStatus("Missing sid"); return; }
    setStatus("Starting phone peer...");
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate && e.candidate.type) {
        setIceInfo((s) => s || (e.candidate.type === "relay" ? "relayed" : "non-relay"));
      }
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      await localVideoRef.current.play().catch(()=>{});
    }
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const stateRes = await fetch(`/api/pair/state?sid=${encodeURIComponent(sid)}`);
    const state = await stateRes.json();
    if (!state?.offer) { setStatus("Waiting for desktop offer..."); return; }
    await pc.setRemoteDescription(state.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitGathering(pc);
    await fetch("/api/pair/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid, answer: pc.localDescription }) });
    setStatus("Answer sent. Streaming to desktop...");
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-3 text-2xl font-semibold">Phone Camera Pairing</h1>
      <div className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">Uses your TURN credentials for reliable WebRTC (relayed={iceInfo||"?"}).</div>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm">Role</label>
        <select className="rounded border border-zinc-300 bg-transparent p-1 text-sm dark:border-zinc-700" value={role} onChange={(e)=>setRole(e.target.value as any)}>
          <option value="desktop">Desktop (receiver)</option>
          <option value="phone">Phone (sender)</option>
        </select>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" placeholder="Session ID" value={sid} onChange={(e)=>setSid(e.target.value)} />
        {role === "desktop" && (
          <button className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" onClick={createSession}>Create Session</button>
        )}
      </div>

      {role === "desktop" ? (
        <div className="mb-4">
          <div className="mb-2 text-sm">1) Create session, 2) Scan QR on phone, 3) Start Desktop, 4) Allow camera on phone.</div>
          {sid && (
            <div className="mb-3 flex items-center gap-4">
              <img alt="qr" className="h-40 w-40 rounded border border-zinc-300 dark:border-zinc-700" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`} />
              <div className="text-xs break-all text-zinc-600 dark:text-zinc-400">{link}</div>
            </div>
          )}
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700" onClick={startDesktop} disabled={!sid}>Start Desktop</button>
          <div className="mt-3">
            <video ref={remoteVideoRef} className="h-72 w-full rounded bg-black object-contain" playsInline />
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <div className="mb-2 text-sm">Open this page from your phone via QR, then tap Start Phone and allow camera.</div>
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700" onClick={startPhone} disabled={!sid}>Start Phone</button>
          <div className="mt-3">
            <video ref={localVideoRef} className="h-56 w-full rounded bg-black object-contain" muted playsInline />
          </div>
        </div>
      )}

      {status && <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{status}</div>}
    </div>
  );
}
