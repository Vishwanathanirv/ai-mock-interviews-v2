"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEVEL_LABELS, LEVELS, ROLE_LABELS, ROLES, type Focus, type Level, type Role } from "@/lib/interview/types";

const ROLE_HINTS: Record<Role, string> = {
  frontend: "React, rendering, performance, accessibility",
  backend: "APIs, databases, transactions, scaling",
  fullstack: "End-to-end features, deployment, web security",
  devops: "Linux, systemd, SELinux, containers, CI/CD",
  security: "Detection, TLS, incident response, AppSec",
  data: "ML evaluation, imbalance, drift, LLM apps",
};

const FOCUS: { v: Focus; t: string; d: string }[] = [
  { v: "mixed", t: "Mixed", d: "Alternates technical and behavioural, like a real loop" },
  { v: "technical", t: "Technical", d: "Concepts, design and debugging" },
  { v: "behavioral", t: "Behavioural", d: "STAR stories about your experience" },
];

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${active ? "border-ink bg-surface shadow-[0_0_0_1px_var(--ink)]" : "border-line bg-surface hover:border-faint"}`}
    >
      {children}
    </button>
  );
}

export function SetupForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("fullstack");
  const [level, setLevel] = useState<Level>("junior");
  const [focus, setFocus] = useState<Focus>("mixed");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, level, focus, totalQuestions: count }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/interview/${data.id}`);
    else {
      setError(data.error ?? "Could not start the interview.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-10">
      <fieldset>
        <legend className="mb-3 font-medium">Role</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <Choice key={r} active={role === r} onClick={() => setRole(r)}>
              <div className="font-medium">{ROLE_LABELS[r]}</div>
              <div className="mt-1 text-sm text-muted">{ROLE_HINTS[r]}</div>
            </Choice>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Level</legend>
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={`rounded-full px-4 py-2 text-sm transition ${level === l ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">Interview type</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {FOCUS.map((f) => (
            <Choice key={f.v} active={focus === f.v} onClick={() => setFocus(f.v)}>
              <div className="font-medium">{f.t}</div>
              <div className="mt-1 text-sm text-muted">{f.d}</div>
            </Choice>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-medium">
          Questions <span className="ml-1 font-mono text-sm text-muted">{count}</span>
        </legend>
        <input type="range" min={3} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full max-w-sm accent-[var(--accent)]" aria-label="Number of questions" />
        <p className="mt-1 text-sm text-faint">About {count * 2} minutes. Follow-up questions count towards the total.</p>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex items-center gap-4 border-t border-line pt-6">
        <button className="btn btn-accent" onClick={start} disabled={busy}>
          {busy ? "Preparing…" : "Start interview"}
        </button>
        <span className="text-sm text-muted">
          {ROLE_LABELS[role]} · {LEVEL_LABELS[level]} · {FOCUS.find((f) => f.v === focus)!.t}
        </span>
      </div>
    </div>
  );
}
