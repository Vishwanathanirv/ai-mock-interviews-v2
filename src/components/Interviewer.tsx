"use client";

import { useEffect, useState } from "react";

/**
 * The interviewer's video tile: an illustrated face whose mouth follows the loudness of the
 * voice that is playing, who blinks, and who nods slightly while the candidate is talking.
 */
export function Interviewer({ mouth, speaking, listening, level }: { mouth: number; speaking: boolean; listening: boolean; level: number }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 140);
          loop();
        },
        2600 + Math.random() * 3200,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  const open = speaking ? Math.max(0.08, mouth) : 0;
  const nod = listening ? Math.min(1, level * 3) : 0;
  return (
    // A 16:9 canvas so the tile is filled edge to edge, with the person centred.
    <svg viewBox="0 0 427 240" className="h-full w-full" role="img" aria-label={speaking ? "Interviewer is speaking" : listening ? "Interviewer is listening" : "Interviewer"}>
      <defs>
        <radialGradient id="iv-bg" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#3b4250" />
          <stop offset="100%" stopColor="#1c2027" />
        </radialGradient>
      </defs>
      <rect width="427" height="240" fill="url(#iv-bg)" />
      <g transform="translate(93.5 0)">
      <g style={{ transform: `translateY(${nod * 3}px) rotate(${nod * 1.5}deg)`, transformOrigin: "120px 170px", transition: "transform 160ms ease-out" }}>
        {/* shoulders */}
        <path d="M38 240c6-44 40-66 82-66s76 22 82 66z" fill="#2f5d62" />
        <path d="M104 176l16 22 16-22" fill="none" stroke="#e9e3d6" strokeWidth="5" strokeLinejoin="round" />
        {/* neck and head */}
        <rect x="106" y="146" width="28" height="32" rx="10" fill="#c98f6b" />
        <ellipse cx="120" cy="110" rx="46" ry="54" fill="#d9a07b" />
        {/* hair */}
        <path d="M74 104c-4-38 20-60 48-60 30 0 50 20 46 58-6-16-18-28-40-30-22-2-42 8-54 32z" fill="#2a2421" />
        {/* eyes */}
        <g fill="#231d1a">
          <ellipse cx="102" cy="112" rx="5" ry={blink ? 0.6 : 5.5} />
          <ellipse cx="138" cy="112" rx="5" ry={blink ? 0.6 : 5.5} />
        </g>
        <path d="M93 100q9-5 18 0M129 100q9-5 18 0" stroke="#2a2421" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* nose */}
        <path d="M120 116q-4 12 2 14" stroke="#b47a58" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* mouth: a closed smile, opening with the voice */}
        {open > 0 ? (
          <ellipse cx="120" cy="140" rx={10 + open * 3} ry={1.5 + open * 9} fill="#6b2f2a" />
        ) : (
          <path d="M108 139q12 8 24 0" stroke="#7a3a33" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        )}
      </g>
      </g>
    </svg>
  );
}
