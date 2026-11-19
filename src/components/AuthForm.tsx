"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GuestButton } from "./GuestButton";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    if (res.ok) {
      const next = params.get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
      return;
    }
    setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    setBusy(false);
  }

  return (
    <div className="card mx-auto w-full max-w-md p-7 sm:p-9">
      <p className="eyebrow">{signup ? "New log" : "Your log"}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-pen">{signup ? "Start your practice log" : "Welcome back"}</h1>
      <p className="mt-1.5 text-muted">{signup ? "Save every interview and track your progress." : "Sign in to continue practising."}</p>
      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        {signup && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <input name="name" className="input" autoComplete="name" required maxLength={60} />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input name="email" type="email" className="input" autoComplete="email" required maxLength={120} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Password</span>
          <input name="password" type="password" className="input" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : 1} maxLength={128} />
          {signup && <span className="mt-1.5 block text-xs text-faint">At least 8 characters.</span>}
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <GuestButton className="btn btn-ghost w-full">Continue as guest</GuestButton>
      <p className="mt-6 text-center text-sm text-muted">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={signup ? "/login" : "/signup"} className="text-ink underline underline-offset-4">
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
