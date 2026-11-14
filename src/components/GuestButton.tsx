"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GuestButton({ className = "btn btn-accent", children = "Try it now, no sign-up" }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    // The error sits under the button without taking space, so nothing next to it moves.
    <span className={`relative ${className.includes("w-full") ? "flex w-full" : "inline-flex"} flex-col`}>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/auth/guest", { method: "POST" });
          if (res.ok) {
            router.push("/interview/new");
            router.refresh();
          } else {
            setError((await res.json().catch(() => ({}))).error ?? "Could not start a guest session.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Starting…" : children}
      </button>
      {error && (
        <span role="alert" className={`text-sm text-bad ${className.includes("w-full") ? "mt-1" : "absolute left-0 top-full mt-1.5 whitespace-nowrap"}`}>
          {error}
        </span>
      )}
    </span>
  );
}
