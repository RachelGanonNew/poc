"use client";

interface UserJourneyStatusProps {
  consented: boolean;
  paused: boolean;
  outputMode: "text" | "voice";
  privacyMode: "off" | "local" | "cloud";
  speakingSeconds: number;
  intensityPct: number;
}

export default function UserJourneyStatus({
  consented,
  paused,
  outputMode,
  privacyMode,
  speakingSeconds,
  intensityPct
}: UserJourneyStatusProps) {
  const getCurrentStage = () => {
    if (!consented) return { stage: "Setup", status: "pending", message: "Enable AI Assist to begin" };
    if (paused) return { stage: "Setup", status: "pending", message: "Resume monitoring" };
    if (privacyMode === "off") return { stage: "Setup", status: "pending", message: "Enable Cloud mode for AI features" };
    if (privacyMode === "local") return { stage: "Monitoring", status: "active", message: "Local monitoring active" };
    if (outputMode === "text") return { stage: "Monitoring", status: "active", message: "Text suggestions active" };
    if (outputMode === "voice") return { stage: "Coaching", status: "active", message: "Voice responses active" };
    return { stage: "Results", status: "active", message: "Full AI coaching enabled" };
  };

  const { stage, status, message } = getCurrentStage();

  const getStatusColor = () => {
    switch (status) {
      case "pending": return "text-amber-600 bg-amber-50 border-amber-200";
      case "active": return "text-emerald-600 bg-emerald-50 border-emerald-200";
      case "complete": return "text-blue-600 bg-blue-50 border-blue-200";
      default: return "text-zinc-600 bg-zinc-50 border-zinc-200";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "pending":
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        );
      case "active":
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case "complete":
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000 2H6a2 2 0 100 4h2a2 2 0 100 4h-.5a1 1 0 000 2H8a2 2 0 002-2V5a2 2 0 00-2-2H4z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${getStatusColor()}`}>
      {getStatusIcon()}
      <span className="font-semibold">{stage}:</span>
      <span>{message}</span>
      {consented && !paused && (
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            {speakingSeconds}s
          </span>
          <span>{intensityPct}%</span>
        </div>
      )}
    </div>
  );
}
