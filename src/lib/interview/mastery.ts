import { BEHAVIORAL, TECHNICAL } from "./bank";
import type { QuestionKind, Role } from "./types";

/**
 * How well the candidate knows each topic, estimated from every answer they have given.
 *
 * Each topic has a Beta posterior over "probability of a strong answer". Every answer adds
 * evidence: its score (nudged up for hard questions, down for easy ones) split into success
 * and failure, weighted so that answers from months ago count less than last week's. The result
 * is a mastery estimate with an honest uncertainty band: one lucky answer does not make a topic
 * "strong", and a topic not practised for a while drifts back towards unknown.
 *
 * On top of that, a simple spaced-practice schedule (weak topics come back after a day,
 * developing ones after three, strong ones after ten) decides what is due.
 */

export type Evidence = { questionId: string; score: number; at: number; difficulty?: number };

export type MasteryStatus = "weak" | "developing" | "strong";

export type TopicMastery = {
  topic: string;
  kind: QuestionKind;
  roles: Role[];
  /** Posterior mean, 0 to 1. */
  mean: number;
  /** 80% credible interval. */
  low: number;
  high: number;
  answers: number;
  lastPracticed: number;
  nextDue: number;
  due: boolean;
  status: MasteryStatus;
};

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 30;
const PSEUDO_TRIALS = 3; // each answer counts like three attempts
const PRIOR = { a: 1, b: 1 }; // flat: no assumption before the first answer
const INTERVAL_DAYS: Record<MasteryStatus, number> = { weak: 1, developing: 3, strong: 10 };

type Meta = { topic: string; kind: QuestionKind; difficulty: number; roles: Role[] };

/** Question id → topic, built from the bank (follow-ups share their parent's topic). */
const META: Map<string, Meta> = (() => {
  const m = new Map<string, Meta>();
  for (const [role, qs] of Object.entries(TECHNICAL) as [Role, (typeof TECHNICAL)[Role]][]) {
    for (const q of qs) {
      const prev = m.get(q.id);
      m.set(q.id, { topic: q.topic, kind: q.kind, difficulty: q.difficulty, roles: prev ? [...prev.roles, role] : [role] });
    }
  }
  for (const q of BEHAVIORAL) m.set(q.id, { topic: q.topic, kind: q.kind, difficulty: q.difficulty, roles: [] });
  return m;
})();

export const topicOf = (questionId: string) => META.get(questionId.replace(/:probe\d*$/, ""));

/** Inverse of the regularised incomplete beta is overkill here: a normal approximation is plenty. */
function interval(a: number, b: number) {
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { mean, low: Math.max(0, mean - 1.2816 * sd), high: Math.min(1, mean + 1.2816 * sd) };
}

export function estimateMastery(evidence: Evidence[], now = Date.now()): TopicMastery[] {
  const acc = new Map<string, { meta: Meta; a: number; b: number; n: number; last: number }>();
  for (const e of evidence) {
    const meta = topicOf(e.questionId);
    if (!meta) continue;
    const difficulty = e.difficulty ?? meta.difficulty;
    const p = Math.max(0, Math.min(1, e.score / 100 + (difficulty - 2) * 0.05));
    const ageDays = Math.max(0, (now - e.at) / DAY);
    const w = 0.5 ** (ageDays / HALF_LIFE_DAYS) * PSEUDO_TRIALS;
    const s = acc.get(meta.topic) ?? { meta, a: PRIOR.a, b: PRIOR.b, n: 0, last: 0 };
    s.a += w * p;
    s.b += w * (1 - p);
    s.n++;
    s.last = Math.max(s.last, e.at);
    acc.set(meta.topic, s);
  }
  return [...acc.values()]
    .map(({ meta, a, b, n, last }) => {
      const { mean, low, high } = interval(a, b);
      // Strong only when even the pessimistic end of the band is good; weak when even the optimistic end is poor.
      const status: MasteryStatus = high < 0.58 ? "weak" : low > 0.62 ? "strong" : "developing";
      const nextDue = last + INTERVAL_DAYS[status] * DAY;
      return { topic: meta.topic, kind: meta.kind, roles: meta.roles, mean: +mean.toFixed(3), low: +low.toFixed(3), high: +high.toFixed(3), answers: n, lastPracticed: last, nextDue, due: now >= nextDue, status };
    })
    .sort((x, y) => x.mean - y.mean);
}

/**
 * The topics most worth practising next: low mastery first, then uncertainty (we know little),
 * with a bonus for topics that are due.
 */
export function practicePlan(m: TopicMastery[], opts: { role?: Role; limit?: number } = {}): TopicMastery[] {
  const pool = m.filter((t) => t.status !== "strong" || t.due).filter((t) => !opts.role || t.kind === "behavioral" || t.roles.includes(opts.role));
  const priority = (t: TopicMastery) => 1 - t.mean + 0.5 * (t.high - t.low) + (t.due ? 0.15 : 0);
  return [...pool].sort((a, b) => priority(b) - priority(a)).slice(0, opts.limit ?? 3);
}
