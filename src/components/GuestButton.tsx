"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GuestButton({ className = "btn btn-accent", children = "Try it now, no sign-up" }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={`${className.includes("w-full") ? "flex w-full" : "inline-flex items-start"} flex-col gap-1`}>
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
      {error && <span className="text-sm text-bad">{error}</span>}
    </span>
  );
}
