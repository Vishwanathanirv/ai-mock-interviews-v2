"use client";

import { useEffect } from "react";

/**
 * Wakes the server and the database while the visitor reads the page. On Vercel and Neon both
 * sleep when idle, and waking them is what made the first click take a few seconds.
 */
export function Warmup() {
  useEffect(() => {
    const t = setTimeout(() => void fetch("/api/health", { cache: "no-store" }).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}
