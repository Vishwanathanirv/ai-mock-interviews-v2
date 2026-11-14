import { poolFor, BEHAVIORAL } from "./bank";
import type {
  AnswerEvaluation,
  AskedQuestion,
  BankQuestion,
  FinalReport,
  HistoryItem,
  InterviewConfig,
  Level,
  ScoreBreakdown,
} from "./types";

const START_DIFFICULTY: Record<Level, number> = { intern: 1, junior: 1.5, mid: 2, senior: 2.5 };

export function toAsked(b: BankQuestion, followUp?: { parentId: string; text: string }): AskedQuestion {
  return {
    id: followUp ? `${b.id}:probe` : b.id,
    kind: b.kind,
    topic: b.topic,
    difficulty: b.difficulty,
    text: followUp?.text ?? b.text,
    concepts: b.concepts,
    isFollowUp: Boolean(followUp),
    parentId: followUp?.parentId,
  };
}

/** Deterministic pseudo-random so the same seed reproduces an interview in tests. */
export function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Target difficulty moves up after strong answers and down after weak ones. */
export function targetDifficulty(cfg: InterviewConfig, history: HistoryItem[]): number {
  let d = START_DIFFICULTY[cfg.level];
  for (const h of history) {
    if (h.evaluation.score >= 75) d += 0.5;
    else if (h.evaluation.score < 50) d -= 0.5;
  }
  return Math.max(1, Math.min(3, d));
}

export function firstQuestion(cfg: InterviewConfig, seed: string): AskedQuestion {
  if (cfg.focus !== "technical") return toAsked(BEHAVIORAL[0]);
  return pickNext(cfg, [], seed)!;
}

/**
 * Decides what to ask next: a probing follow-up when a strong concept was missed,
 * otherwise a fresh question near the adaptive difficulty, alternating kinds for mixed interviews.
 */
export function pickNext(cfg: InterviewConfig, history: HistoryItem[], seed: string): AskedQuestion | null {
  if (history.length >= cfg.totalQuestions) return null;
  const last = history.at(-1);
  if (last && !last.question.isFollowUp && shouldProbe(last.evaluation) && history.length < cfg.totalQuestions - 1) {
    const bank = poolFor(cfg.role, cfg.focus).find((b) => b.id === last.question.id);
    if (bank?.probe) {
      return toAsked(bank, { parentId: bank.id, text: bank.probe.replace("{concept}", last.evaluation.missing[0]) });
    }
  }
  const asked = new Set(history.map((h) => h.question.parentId ?? h.question.id));
  let pool = poolFor(cfg.role, cfg.focus).filter((b) => !asked.has(b.id));
  if (cfg.focus === "mixed" && last) {
    const wantKind = last.question.kind === "technical" ? "behavioral" : "technical";
    const sameKind = pool.filter((b) => b.kind === wantKind);
    if (sameKind.length) pool = sameKind;
  }
  if (!pool.length) return null;
  const target = targetDifficulty(cfg, history);
  const rand = seeded(`${seed}:${history.length}`);
  const ranked = pool
    .map((b) => ({ b, d: Math.abs(b.difficulty - target) + rand() * 0.6 }))
    .sort((a, b) => a.d - b.d);
  return toAsked(ranked[0].b);
}

function shouldProbe(e: AnswerEvaluation): boolean {
  return e.missing.length > 0 && e.score < 65 && e.metrics.words >= 8;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function buildReport(cfg: InterviewConfig, history: HistoryItem[], source: "ai" | "rules", summary?: string): FinalReport {
  const evals = history.map((h) => h.evaluation);
  const breakdown: ScoreBreakdown = {
    content: Math.round(avg(evals.map((e) => e.breakdown.content))),
    depth: Math.round(avg(evals.map((e) => e.breakdown.depth))),
    structure: Math.round(avg(evals.map((e) => e.breakdown.structure))),
    delivery: Math.round(avg(evals.map((e) => e.breakdown.delivery))),
  };
  // Harder questions weigh more, so a senior candidate is not rewarded for acing only warm-ups.
  const weights = history.map((h) => 0.8 + h.question.difficulty * 0.2);
  const overall = Math.round(evals.reduce((a, e, i) => a + e.score * weights[i], 0) / (weights.reduce((a, b) => a + b, 0) || 1));
  const verdict: FinalReport["verdict"] = overall >= 75 ? "Strong" : overall >= 55 ? "Promising" : "Needs practice";

  const tally = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const missingTopics = tally(history.filter((h) => h.question.kind === "technical").flatMap((h) => h.evaluation.missing.map((m) => `${m} (${h.question.topic})`)));
  const wpms = evals.map((e) => e.metrics.wpm).filter((x): x is number => x !== null);
  const words = evals.reduce((a, e) => a + e.metrics.words, 0);
  const fillers = evals.reduce((a, e) => a + e.metrics.fillerCount, 0);
  const minutes = wpms.length ? +(evals.reduce((a, e) => a + (e.metrics.wpm ? e.metrics.words / e.metrics.wpm : 0), 0)).toFixed(1) : 0;

  const weakest = (Object.entries(breakdown) as [keyof ScoreBreakdown, number][]).sort((a, b) => a[1] - b[1])[0][0];
  const strongest = (Object.entries(breakdown) as [keyof ScoreBreakdown, number][]).sort((a, b) => b[1] - a[1])[0][0];

  return {
    overall,
    verdict,
    summary:
      summary ??
      `${verdict === "Strong" ? "A strong interview." : verdict === "Promising" ? "A solid base with clear room to grow." : "A good first practice run."} Your strongest area was ${strongest}; the biggest gains will come from ${weakest}.`,
    breakdown,
    strengths: tally(evals.flatMap((e) => e.strengths)).slice(0, 4),
    improvements: tally(evals.flatMap((e) => e.improvements)).slice(0, 4),
    studyTopics: missingTopics.slice(0, 6),
    delivery: { avgWpm: wpms.length ? Math.round(avg(wpms)) : null, fillerRate: words ? +(fillers / words).toFixed(3) : 0, totalWords: words, totalMinutes: minutes },
    source,
  };
}
