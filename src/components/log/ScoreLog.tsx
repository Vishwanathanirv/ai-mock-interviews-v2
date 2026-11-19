import { HIRE_BAR } from "@/lib/interview/planner";
import { LEVEL_LABELS, ROLE_LABELS, type Level, type Role } from "@/lib/interview/types";

export type LogPoint = { id: string; score: number; role: Role; level: Level; at: Date };

const W = 720;
const H = 260;
const PAD = { l: 40, r: 24, t: 20, b: 34 };

/**
 * Every finished interview plotted in ink on the notebook's graph paper, with the hiring bar for
 * each one drawn as a red-pencil tick. Each point is a link to its report.
 */
export function ScoreLog({ points }: { points: LogPoint[] }) {
  const n = points.length;
  // Points sit inside the axis so their labels never collide with the scale.
  const INSET = 28;
  const x = (i: number) => PAD.l + INSET + (n === 1 ? (W - PAD.l - PAD.r - INSET * 2) / 2 : (i * (W - PAD.l - PAD.r - INSET * 2)) / (n - 1));
  const y = (v: number) => PAD.t + ((100 - v) * (H - PAD.t - PAD.b)) / 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const best = points.reduce((b, p, i) => (p.score > points[b].score ? i : b), 0);
  const fmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
  const cleared = points.filter((p) => p.score >= HIRE_BAR[p.level]).length;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="group" aria-label={`Your interview scores in order: ${points.map((p) => p.score).join(", ")}. ${cleared} of ${n} cleared the hiring bar for their level.`}>
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--grid-major)" strokeWidth={g % 50 ? 0.75 : 1.25} />
            <text x={PAD.l - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono)">
              {g}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const bx = x(i);
          return <line key={`bar-${p.id}`} x1={bx - 14} x2={bx + 14} y1={y(HIRE_BAR[p.level])} y2={y(HIRE_BAR[p.level])} stroke="var(--pencil)" strokeWidth={2} strokeLinecap="round" strokeDasharray="4 3" />;
        })}
        {n > 1 && <path d={line} fill="none" stroke="var(--pen)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => {
          const cx = x(i);
          const cy = y(p.score);
          const label = `${ROLE_LABELS[p.role]}, ${LEVEL_LABELS[p.level]}, ${fmt.format(p.at)}: ${p.score} against a bar of ${HIRE_BAR[p.level]}. Open the report.`;
          return (
            <a key={p.id} href={`/report/${p.id}`} aria-label={label} className="group outline-none">
              <circle cx={cx} cy={cy} r={16} fill="transparent" />
              <circle cx={cx} cy={cy} r={5} fill="var(--paper)" stroke="var(--pen)" strokeWidth={2.25} className="transition-[r] group-hover:[r:7] group-focus-visible:[r:7]" />
              <circle cx={cx} cy={cy} r={11} fill="none" stroke="var(--pen)" strokeWidth={1.5} opacity={0} className="group-focus-visible:opacity-100" />
              <text x={cx} y={cy - 12} textAnchor="middle" fontSize="12" fontWeight={600} fill="var(--pen)" fontFamily="var(--font-mono)">
                {p.score}
              </text>
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-mono)">
                {n <= 12 || i % Math.ceil(n / 12) === 0 ? fmt.format(p.at) : ""}
              </text>
            </a>
          );
        })}
        {n > 0 && (
          <ellipse cx={x(best)} cy={y(points[best].score) - 4} rx={22} ry={20} fill="none" stroke="var(--pencil)" strokeWidth={1.4} transform={`rotate(-8 ${x(best)} ${y(points[best].score) - 4})`} aria-hidden="true" />
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <span>
          <span className="mr-1.5 inline-block h-0 w-5 border-t-2 border-pen align-middle" />
          your score
        </span>
        <span>
          <span className="mr-1.5 inline-block h-0 w-5 border-t-2 border-dashed border-pencil align-middle" />
          hiring bar for that level
        </span>
        <span>
          <span className="mr-1.5 inline-block size-3 rounded-full border border-pencil align-middle" />
          your best
        </span>
      </figcaption>
    </figure>
  );
}
