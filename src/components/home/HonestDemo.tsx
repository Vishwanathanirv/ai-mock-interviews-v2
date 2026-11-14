"use client";

import { useState } from "react";
import { detectRedFlags } from "@/lib/interview/analyzer";

const EXAMPLES = [
  "Honestly I'm lying in bed right now lol, but basically I'd just add caching.",
  "I don't know, skip.",
  "I'd profile first, find the slow query, add an index on user id and measure again.",
];

export function HonestDemo() {
  const [text, setText] = useState(EXAMPLES[0]);
  const { flags, advice } = detectRedFlags(text);

  return (
    <div className="rounded-md border-[1.5px] border-pen/70 bg-paper p-5 sm:p-6">
      <label htmlFor="honest" className="text-sm text-muted">
        Your answer to &ldquo;How would you speed up a slow page?&rdquo;
      </label>
      <textarea id="honest" rows={3} value={text} onChange={(e) => setText(e.target.value)} className="mt-2 w-full resize-none rounded-md border border-pen/40 bg-transparent p-3 font-display text-lg leading-snug text-pen outline-none focus:border-pen focus:ring-2 focus:ring-pen/30" />
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {EXAMPLES.map((e, i) => (
          <button key={i} type="button" className="text-muted underline decoration-pen/30 underline-offset-4 hover:text-ink" onClick={() => setText(e)}>
            {["Too relaxed", "Gives up", "Real answer"][i]}
          </button>
        ))}
      </div>

      <div className="mt-5 border-l-2 border-pencil pl-4" aria-live="polite">
        {flags.length ? (
          <>
            <p className="font-medium text-pencil">Maya stops you here: {flags.join(", ")}.</p>
            <p className="mt-1.5 leading-relaxed text-muted">{advice[0]}</p>
          </>
        ) : (
          <p className="leading-relaxed text-muted">No red flags. Now the answer itself is graded on what you covered, how deep you went and how you structured it.</p>
        )}
      </div>
    </div>
  );
}
