/**
 * One measurement on a ruler, the way the notebook records readings: the target band is shaded
 * in red pencil and your value is an ink mark. Values outside the scale are pinned to its end.
 */
export function Ruler({ label, value, unit, min, max, band, note }: { label: string; value: number | null; unit: string; min: number; max: number; band: [number, number]; note: string }) {
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const inBand = value !== null && value >= band[0] && value <= band[1];
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className={`font-mono text-xl font-semibold tabular-nums ${value === null ? "text-muted" : inBand ? "text-pen" : "text-pencil"}`}>
          {value === null ? "–" : `${value}${unit}`}
        </span>
      </div>
      <div
        className="relative mt-2 h-7"
        role="img"
        aria-label={value === null ? `${label}: not measured` : `${label}: ${value}${unit}, target ${band[0]} to ${band[1]}${unit}, ${inBand ? "within" : "outside"} the target`}
      >
        <div className="absolute inset-x-0 bottom-2 h-px" style={{ background: "var(--pen)" }} />
        {ticks.map((t) => (
          <div key={t} className="absolute bottom-2 w-px" style={{ left: `${t}%`, height: t % 50 ? 5 : 9, background: "var(--pen)", opacity: 0.55 }} />
        ))}
        <div className="absolute bottom-2 h-3 border-x border-pencil" style={{ left: `${pct(band[0])}%`, width: `${pct(band[1]) - pct(band[0])}%`, background: "color-mix(in oklab, var(--pencil) 18%, transparent)" }} />
        {value !== null && <div className="absolute bottom-0.5 h-6 w-[3px] -translate-x-1/2 rounded-full" style={{ left: `${pct(value)}%`, background: "var(--pen)" }} />}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.65rem] text-muted">
        <span>{min}</span>
        <span>{max}+</span>
      </div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}
