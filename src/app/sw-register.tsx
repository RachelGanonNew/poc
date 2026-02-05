"use client";
import { useEffect } from "react";

export default function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      const register = async () => {
        try {
          await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        } catch (e) {
          // no-op
        }
      };
      // iOS Safari ignores SW unless served over HTTPS and with user interaction
      // Still attempt registration on mount.
      register();
    }
  }, []);
  return null;
}
