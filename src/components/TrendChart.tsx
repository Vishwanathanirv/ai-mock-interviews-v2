export function TrendChart({ values, height = 120 }: { values: number[]; height?: number }) {
  const w = 600;
  const pad = 14;
  const xs = values.map((_, i) => pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1));
  const ys = values.map((v) => pad + ((100 - v) * (height - pad * 2)) / 100);
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${d} L${xs.at(-1)!.toFixed(1)},${height - pad} L${xs[0].toFixed(1)},${height - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-32 w-full" preserveAspectRatio="none" role="img" aria-label={`Scores: ${values.join(", ")}`}>
      {[25, 50, 75].map((g) => {
        const y = pad + ((100 - g) * (height - pad * 2)) / 100;
        return <line key={g} x1={pad} x2={w - pad} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />;
      })}
      <path d={area} fill="var(--accent-soft)" opacity={0.7} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={3.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
