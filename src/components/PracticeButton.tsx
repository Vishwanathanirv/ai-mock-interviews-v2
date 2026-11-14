"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Level, Role } from "@/lib/interview/types";

/** Starts a short interview aimed at the practice plan's topics. */
export function PracticeButton({ role, level, topics }: { role: Role; level: Level; topics: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, level, focus: "mixed", totalQuestions: Math.min(6, Math.max(3, topics.length + 2)), targets: topics }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/interview/${data.id}`);
    else {
      setError(data.error ?? "Could not start the practice session.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="btn btn-accent" onClick={go} disabled={busy || !topics.length}>
        {busy ? "Preparing…" : "Practise my weak spots"}
      </button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
