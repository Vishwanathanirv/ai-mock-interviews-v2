export function scoreTone(score: number) {
  return score >= 75 ? "var(--good)" : score >= 55 ? "var(--warn)" : "var(--bad)";
}

export function ScoreRing({ score, size = 132, stroke = 10, label = "Overall" }: { score: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label} score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreTone(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-[2.1rem] font-semibold leading-none tracking-tight">{score}</div>
        <div className="mt-1 text-[0.7rem] uppercase tracking-[0.14em] text-muted">{label}</div>
      </div>
    </div>
  );
}

export function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="capitalize text-muted">{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: scoreTone(value), transition: "width .8s ease" }} />
      </div>
    </div>
  );
}

export function ScorePill({ score }: { score: number }) {
  const bg = score >= 75 ? "var(--good-soft)" : score >= 55 ? "var(--warn-soft)" : "var(--bad-soft)";
  return (
    <span className="inline-flex min-w-11 justify-center rounded-full px-2.5 py-1 font-mono text-xs font-medium tabular-nums" style={{ background: bg, color: scoreTone(score) }}>
      {score}
    </span>
  );
}
