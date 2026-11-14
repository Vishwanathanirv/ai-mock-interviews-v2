import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ScorePill } from "@/components/ScoreRing";
import { TrendChart } from "@/components/TrendChart";
import { getSession } from "@/lib/auth/session";
import { PracticeButton } from "@/components/PracticeButton";
import { practicePlan, type TopicMastery } from "@/lib/interview/mastery";
import { getMastery, listInterviews } from "@/lib/interview/service";
import { LEVEL_LABELS, ROLE_LABELS, type Level, type Role } from "@/lib/interview/types";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function Dashboard() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [rows, mastery] = await Promise.all([listInterviews(s.sub), getMastery(s.sub)]);
  const latest = rows[0];
  const plan = latest ? practicePlan(mastery.topics, { role: latest.role as Role }) : [];
  const done = rows.filter((r) => r.status === "completed" && r.overallScore !== null);
  const scores = done.map((r) => Math.round(r.overallScore!)).reverse();
  const best = scores.length ? Math.max(...scores) : null;
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const trend = scores.length >= 2 ? scores.at(-1)! - scores[0] : null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{s.guest ? "Your practice sessions" : `Hi ${s.name.split(" ")[0]}, ready to practise?`}</h1>
          </div>
          <Link href="/interview/new" className="btn btn-accent">
            Start a new interview
          </Link>
        </div>

        {s.guest && (
          <p className="mt-6 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
            You&apos;re practising as a guest. <Link href="/signup" className="text-ink underline underline-offset-4">Create an account</Link> to keep your history on any device.
          </p>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { k: "Interviews completed", v: done.length ? String(done.length) : "0" },
            { k: "Average score", v: avg !== null ? String(avg) : "–" },
            { k: "Best score", v: best !== null ? String(best) : "–", sub: trend !== null ? `${trend >= 0 ? "+" : ""}${trend} since your first` : undefined },
          ].map((c) => (
            <div key={c.k} className="card p-5">
              <div className="text-sm text-muted">{c.k}</div>
              <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{c.v}</div>
              {c.sub && <div className="mt-1 text-xs text-faint">{c.sub}</div>}
            </div>
          ))}
        </section>

        {scores.length >= 2 && (
          <section className="card mt-4 p-5">
            <div className="mb-3 text-sm text-muted">Score over time</div>
            <TrendChart values={scores} />
          </section>
        )}

        {mastery.topics.length > 0 && (
          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-tight">Skill map</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted">
                  Estimated from all {mastery.answers} of your answers. The bar is the best estimate; the shaded band is how sure it is, and it narrows as you practise. Recent answers count more than old ones.
                </p>
              </div>
              {latest && plan.length > 0 && <PracticeButton role={latest.role as Role} level={latest.level as Level} topics={plan.map((p) => p.topic)} />}
            </div>
            {plan.length > 0 && (
              <p className="mt-3 text-sm">
                <span className="text-muted">Next up:</span> {plan.map((p) => p.topic).join(", ")}
              </p>
            )}
            <ul className="card mt-4 divide-y divide-line">
              {mastery.topics.map((t) => (
                <SkillRow key={t.topic} t={t} />
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold tracking-tight">History</h2>
          {rows.length === 0 ? (
            <div className="card mt-4 grid place-items-center px-6 py-16 text-center">
              <p className="font-medium">No interviews yet</p>
              <p className="mt-1 max-w-sm text-muted">Your first session takes about ten minutes. Pick a role and answer out loud.</p>
              <Link href="/interview/new" className="btn btn-primary mt-6">
                Start your first interview
              </Link>
            </div>
          ) : (
            <ul className="card mt-4 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={r.status === "completed" ? `/report/${r.id}` : `/interview/${r.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2/60">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{ROLE_LABELS[r.role as Role]}</div>
                      <div className="mt-0.5 text-sm text-muted">
                        {LEVEL_LABELS[r.level as Level]} · <span className="capitalize">{r.focus}</span> · {fmt.format(r.createdAt)}
                      </div>
                    </div>
                    {r.status === "completed" && r.overallScore !== null ? (
                      <ScorePill score={Math.round(r.overallScore)} />
                    ) : (
                      <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">Resume</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

const STATUS: Record<TopicMastery["status"], { label: string; cls: string }> = {
  weak: { label: "Needs work", cls: "bg-bad-soft text-bad" },
  developing: { label: "Developing", cls: "bg-warn-soft text-warn" },
  strong: { label: "Strong", cls: "bg-good-soft text-good" },
};

function SkillRow({ t }: { t: TopicMastery }) {
  const s = STATUS[t.status];
  return (
    <li className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
      <div className="min-w-0">
        <div className="truncate font-medium">{t.topic}</div>
        <div className="text-xs text-faint">
          {t.kind === "behavioral" ? "Behavioural" : "Technical"} · {t.answers} answer{t.answers === 1 ? "" : "s"}
          {t.due ? " · due for review" : ""}
        </div>
      </div>
      <div className="relative h-2.5 rounded-full bg-surface-2" role="img" aria-label={`${t.topic}: about ${Math.round(t.mean * 100)}%, likely between ${Math.round(t.low * 100)} and ${Math.round(t.high * 100)}`}>
        <div className="absolute inset-y-0 rounded-full bg-accent/25" style={{ left: `${t.low * 100}%`, width: `${(t.high - t.low) * 100}%` }} />
        <div className="absolute inset-y-[-3px] w-1 rounded-full bg-accent" style={{ left: `calc(${t.mean * 100}% - 2px)` }} />
      </div>
      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span>
    </li>
  );
}
