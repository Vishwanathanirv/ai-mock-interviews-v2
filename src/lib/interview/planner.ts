import { poolFor, BEHAVIORAL } from "./bank";
import type {
  AnswerEvaluation,
  AskedQuestion,
  BankQuestion,
  FinalReport,
  HireCall,
  HistoryItem,
  InterviewConfig,
  Level,
  ScoreBreakdown,
} from "./types";
import { LEVEL_LABELS, ROLE_LABELS } from "./types";

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
  // A targeted session goes straight to the weak topics; otherwise warm up with an introduction.
  if (cfg.focus !== "technical" && !cfg.targets?.length) return toAsked(BEHAVIORAL[0]);
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
  let pool = poolFor(cfg.role, cfg.targets?.length ? "mixed" : cfg.focus).filter((b) => !asked.has(b.id));
  if (cfg.targets?.length) {
    // Practice-plan sessions draw from the target topics first, and only then from the rest.
    const wanted = new Set(cfg.targets);
    const targeted = pool.filter((b) => wanted.has(b.topic));
    if (targeted.length) return toAsked(rankByDifficulty(cfg, history, targeted, seed));
    pool = poolFor(cfg.role, cfg.focus).filter((b) => !asked.has(b.id));
  }
  if (cfg.focus === "mixed" && last) {
    const wantKind = last.question.kind === "technical" ? "behavioral" : "technical";
    const sameKind = pool.filter((b) => b.kind === wantKind);
    if (sameKind.length) pool = sameKind;
  }
  if (!pool.length) return null;
  return toAsked(rankByDifficulty(cfg, history, pool, seed));
}

/** The question nearest the adaptive difficulty, with a little seeded randomness to vary sessions. */
function rankByDifficulty(cfg: InterviewConfig, history: HistoryItem[], pool: BankQuestion[], seed: string): BankQuestion {
  const target = targetDifficulty(cfg, history);
  const rand = seeded(`${seed}:${history.length}`);
  return pool.map((b) => ({ b, d: Math.abs(b.difficulty - target) + rand() * 0.6 })).sort((a, b) => a.d - b.d)[0].b;
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

  const decision = hiringDecision(cfg, history, overall, breakdown);
  return {
    overall,
    verdict,
    summary:
      summary ??
      `${decision.nextRound ? "As it stands, this would likely get you to the next round." : "As it stands, this wouldn't pass a real interview."} Your strongest area was ${strongest}; the biggest gains will come from ${weakest}.`,
    breakdown,
    strengths: tally(evals.flatMap((e) => e.strengths)).slice(0, 4),
    improvements: tally(evals.flatMap((e) => e.improvements)).slice(0, 4),
    studyTopics: missingTopics.slice(0, 6),
    decision,
    delivery: { avgWpm: wpms.length ? Math.round(avg(wpms)) : null, fillerRate: words ? +(fillers / words).toFixed(3) : 0, totalWords: words, totalMinutes: minutes, ...voiceSummary(evals), ...videoSummary(evals) },
    source,
  };
}

/** Voice measurements across the spoken answers of an interview. */
function voiceSummary(evals: AnswerEvaluation[]): { voice?: FinalReport["delivery"]["voice"] } {
  const vs = evals.map((e) => e.metrics.voice).filter((v): v is NonNullable<typeof v> => Boolean(v));
  if (!vs.length) return {};
  const sds = vs.map((v) => v.pitchSdSemitones).filter((x): x is number => x !== null);
  const speakingMin = vs.reduce((a, v) => a + v.durationSec, 0) / 60;
  return {
    voice: {
      answers: vs.length,
      pitchSdSemitones: sds.length ? +avg(sds).toFixed(2) : null,
      monotoneAnswers: vs.filter((v) => v.monotone).length,
      pausesPerMinute: speakingMin ? +(vs.reduce((a, v) => a + v.pauses, 0) / speakingMin).toFixed(1) : 0,
      longestPauseSec: Math.max(...vs.map((v) => v.longestPauseSec)),
      pauseRatio: +avg(vs.map((v) => v.pauseRatio)).toFixed(2),
    },
  };
}

/** On-camera presence across the answers given with the camera on. */
function videoSummary(evals: AnswerEvaluation[]): { video?: FinalReport["delivery"]["video"] } {
  const vs = evals.map((e) => e.metrics.video).filter((v): v is NonNullable<typeof v> => Boolean(v));
  if (!vs.length) return {};
  const mode = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0];
  return {
    video: {
      answers: vs.length,
      eyeContactPct: Math.round(avg(vs.map((v) => v.eyeContactPct))),
      lookAwaysPerAnswer: +avg(vs.map((v) => v.lookAways)).toFixed(1),
      smilePct: Math.round(avg(vs.map((v) => v.smilePct))),
      movement: +avg(vs.map((v) => v.movement)).toFixed(2),
      framing: mode(vs.map((v) => v.framing)),
      lighting: mode(vs.map((v) => v.lighting)),
    },
  };
}

/** The score a candidate needs to clear at each level, like a hiring panel's bar. */
export const HIRE_BAR: Record<Level, number> = { intern: 55, junior: 60, mid: 66, senior: 72 };
const CALLS: HireCall[] = ["No hire", "Lean no hire", "Lean hire", "Hire", "Strong hire"];

/**
 * What a real hiring panel would decide. The score sets the starting call against the bar for
 * the level; conduct problems and non-answers cap it, because in a real interview they decide
 * the outcome on their own, however good the other answers were.
 */
export function hiringDecision(cfg: InterviewConfig, history: HistoryItem[], overall: number, breakdown: ScoreBreakdown): NonNullable<FinalReport["decision"]> {
  const bar = HIRE_BAR[cfg.level];
  let rank = overall >= bar + 15 ? 4 : overall >= bar + 5 ? 3 : overall >= bar ? 2 : overall >= bar - 10 ? 1 : 0;
  const reasons = [`You scored ${overall} against a bar of ${bar} for a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]}.`];

  const flags = new Set(history.flatMap((h) => h.evaluation.redFlags ?? []));
  const conduct = [...flags].filter((f) => f !== "no real answer");
  if (conduct.length) {
    rank = Math.min(rank, 1);
    reasons.push(`How you came across (${conduct.join(", ")}) would end most real interviews on its own, whatever the answers were.`);
  }
  const passes = history.filter((h) => h.evaluation.redFlags?.includes("no real answer")).length;
  if (passes >= 2 || (passes === 1 && history.length <= 3)) {
    rank = Math.min(rank, 1);
    reasons.push(`You gave up on ${passes === 1 ? "a question" : `${passes} questions`} without trying. Panels count that heavily: reasoning out loud almost always scores better than passing.`);
  }
  const tech = history.filter((h) => h.question.kind === "technical");
  if (cfg.level === "senior" && tech.length && !tech.some((h) => h.evaluation.score >= 70)) {
    rank = Math.min(rank, 2);
    reasons.push("At senior level the panel needs at least one technical answer that shows real depth, and none did.");
  }
  const areas = Object.entries(breakdown) as [keyof ScoreBreakdown, number][];
  const best = [...areas].sort((a, b) => b[1] - a[1])[0];
  const worst = [...areas].sort((a, b) => a[1] - b[1])[0];
  if (best[1] >= 70) reasons.push(`Your ${best[0]} held up well (${best[1]}).`);
  if (worst[1] < bar) reasons.push(`Your ${worst[0]} was below the bar (${worst[1]}), and that's what would hold you back.`);

  const call = CALLS[rank];
  return { call, bar, nextRound: rank >= 2, reasons };
}
