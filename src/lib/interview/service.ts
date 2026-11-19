import "server-only";
import { after } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isUuid } from "@/lib/request-guard";
import type { VideoMetrics } from "@/lib/video/analysis";
import type { VoiceMetrics } from "@/lib/voice/prosody";
import { scoreAnswer } from "./analyzer";
import { estimateMastery } from "./mastery";
import { findQuestion } from "./bank";
import { closingRules } from "./closing";
import { aiEnabled, closingWithAI, evaluateWithAI, summarizeWithAI, turnWithAI } from "./gemini";
import { MAX_DEPTH, buildReport, depthOf, firstQuestion, nextCandidates, pickNext } from "./planner";
import type { AnswerEvaluation, AskedQuestion, HistoryItem, InterviewConfig, Role, Level, Focus, TurnPlan } from "./types";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const configOf = (i: schema.Interview): InterviewConfig => ({
  role: i.role as Role,
  level: i.level as Level,
  focus: i.focus as Focus,
  totalQuestions: i.totalQuestions,
  ...(i.targets?.length ? { targets: i.targets } : {}),
});

async function owned(userId: string, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Interview not found");
  const db = await getDb();
  const [row] = await db.select().from(schema.interviews).where(and(eq(schema.interviews.id, id), eq(schema.interviews.userId, userId)));
  if (!row) throw new NotFoundError("Interview not found");
  return row;
}

async function historyOf(id: string): Promise<{ turns: schema.Turn[]; history: HistoryItem[] }> {
  const db = await getDb();
  const turns = await db.select().from(schema.turns).where(eq(schema.turns.interviewId, id)).orderBy(asc(schema.turns.idx));
  const history = turns.map((t) => {
    const parentId = t.isFollowUp ? t.questionId.replace(/:probe\d*$/, "") : undefined;
    const bank = findQuestion(parentId ?? t.questionId);
    const question: AskedQuestion = {
      id: t.questionId,
      kind: t.kind as AskedQuestion["kind"],
      topic: bank?.topic ?? "General",
      difficulty: bank?.difficulty ?? 2,
      text: t.question,
      concepts: bank?.concepts ?? [],
      isFollowUp: Boolean(t.isFollowUp),
      parentId,
      ...(t.isFollowUp ? { depth: depthOf(t.questionId) } : {}),
    };
    return { question, answer: t.answer, evaluation: t.evaluation };
  });
  return { turns, history };
}

export async function createInterview(userId: string, cfg: InterviewConfig) {
  const db = await getDb();
  const provider = aiEnabled() ? "ai" : "rules";
  const [row] = await db
    .insert(schema.interviews)
    .values({ userId, ...cfg, targets: cfg.targets?.length ? cfg.targets : null, provider, currentQuestion: null })
    .returning();
  const q = firstQuestion(cfg, row.id);
  await db.update(schema.interviews).set({ currentQuestion: q }).where(eq(schema.interviews.id, row.id));
  return { ...row, currentQuestion: q };
}

export async function getInterview(userId: string, id: string) {
  const row = await owned(userId, id);
  const { turns } = await historyOf(id);
  return { interview: row, turns };
}

export async function listInterviews(userId: string) {
  const db = await getDb();
  return db.select().from(schema.interviews).where(eq(schema.interviews.userId, userId)).orderBy(desc(schema.interviews.createdAt)).limit(50);
}

/**
 * Takes one answer and keeps the conversation moving like a person would: a quick decision on
 * what to say and ask next, then the full grading in the background, after the response has
 * gone back, so the candidate never waits on it. The report is finalised once at the end.
 */
export async function submitAnswer(userId: string, id: string, answer: string, durationSec: number, voice?: VoiceMetrics, video?: VideoMetrics) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.status !== "active" || !row.currentQuestion) throw new ConflictError("This interview is already finished.");
  const cfg = configOf(row);
  const q = row.currentQuestion;
  const { history } = await historyOf(id);

  const rules = scoreAnswer(q, answer, durationSec, voice, video);
  const useAI = row.provider === "ai" && aiEnabled();
  const depth = q.isFollowUp ? (q.depth ?? 1) : 0;
  const context = history.map((h) => ({ q: h.question.text, a: h.answer }));
  const draft: HistoryItem[] = [...history, { question: q, answer, evaluation: rules }];

  let plan: TurnPlan | undefined;
  if (useAI) {
    try {
      plan = await turnWithAI(cfg, q, answer, rules, context, nextCandidates(cfg, draft, id), depth < MAX_DEPTH && history.length + 1 < cfg.totalQuestions);
    } catch (err) {
      console.warn("[ai] turn decision failed, using the rules:", (err as Error).message);
    }
  }
  // Conduct seen on camera or heard in the answer is always addressed in his own measured words.
  const conduct = rules.redFlags?.some((f) => f !== "no real answer");
  const evaluation: AnswerEvaluation = { ...rules, reaction: conduct || !plan?.reaction ? rules.reaction : plan.reaction };

  let turnId: string;
  try {
    const [t] = await db
      .insert(schema.turns)
      .values({ interviewId: id, idx: history.length, questionId: q.id, question: q.text, kind: q.kind, isFollowUp: q.isFollowUp ? 1 : 0, answer, durationSec, evaluation })
      .returning();
    turnId = t.id;
  } catch {
    throw new ConflictError("That answer was already submitted.");
  }

  const full: HistoryItem[] = [...history, { question: q, answer, evaluation }];
  const next = pickNext(cfg, full, id, plan ? { followUp: plan.followUp, nextId: plan.nextId } : undefined);
  await db.update(schema.interviews).set({ currentQuestion: next }).where(eq(schema.interviews.id, id));
  if (!next) await finishInterview(userId, id);
  if (useAI) after(() => gradeTurn(cfg, turnId, q, answer, rules, context));
  return { evaluation, next, done: !next, ...(next && !next.isFollowUp && plan?.bridge ? { transition: plan.bridge } : {}) };
}

/** Full AI grading of one stored answer. Keeps what he said out loud; measurements stay measured. */
async function gradeTurn(cfg: InterviewConfig, turnId: string, q: AskedQuestion, answer: string, rules: AnswerEvaluation, context: { q: string; a: string }[]) {
  try {
    const db = await getDb();
    const [cur] = await db.select({ evaluation: schema.turns.evaluation }).from(schema.turns).where(eq(schema.turns.id, turnId));
    if (!cur || cur.evaluation.source === "ai") return;
    const ai = await evaluateWithAI(cfg, q, answer, rules, context);
    const { followUp: _f, ...rest } = ai;
    void _f;
    await db.update(schema.turns).set({ evaluation: { ...rest, reaction: cur.evaluation.reaction, metrics: rules.metrics } }).where(eq(schema.turns.id, turnId));
  } catch (err) {
    console.warn("[ai] background grading failed, keeping rule-based scores:", (err as Error).message);
  }
}

/**
 * Makes sure every answer has its full grade, then writes the final report and the
 * interviewer's honest spoken verdict. Safe to call more than once.
 */
export async function finalizeReport(userId: string, id: string) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.report?.final) return row.report;
  const cfg = configOf(row);
  if (row.provider === "ai" && aiEnabled()) {
    const { turns, history } = await historyOf(id);
    await Promise.all(
      turns.map((t, i) => (t.evaluation.source === "ai" ? null : gradeTurn(cfg, t.id, history[i].question, t.answer, scoreAnswer(history[i].question, t.answer, t.durationSec ?? 0, t.evaluation.metrics.voice, t.evaluation.metrics.video), history.slice(0, i).map((h) => ({ q: h.question.text, a: h.answer }))))),
    );
  }
  const { history } = await historyOf(id);
  if (!history.length) throw new ConflictError("Answer at least one question first.");
  const source = history.some((h) => h.evaluation.source === "ai") ? "ai" : "rules";
  let report = buildReport(cfg, history, source);
  if (source === "ai" && aiEnabled()) {
    try {
      report = { ...report, summary: await summarizeWithAI(cfg, report, history.map((h) => ({ q: h.question.text, a: h.answer, score: h.evaluation.score }))) };
    } catch (err) {
      console.warn("[ai] debrief failed, using the rules debrief:", (err as Error).message);
    }
  }
  const [fresh] = await db.select({ report: schema.interviews.report }).from(schema.interviews).where(eq(schema.interviews.id, id));
  report = { ...report, final: true, ...(fresh?.report?.closing ? { closing: fresh.report.closing } : {}) };
  await db
    .update(schema.interviews)
    .set({ status: "completed", report, overallScore: report.overall, currentQuestion: null, completedAt: row.completedAt ?? new Date() })
    .where(eq(schema.interviews.id, id));
  return report;
}

export async function finishInterview(userId: string, id: string) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.status === "completed" && row.report) return row.report;
  const cfg = configOf(row);
  const { history } = await historyOf(id);
  if (!history.length) throw new ConflictError("Answer at least one question first.");
  // Quick, rules-based draft so the call can wrap up at once; finalizeReport() adds the full
  // grades and the interviewer's own verdict.
  const source = history.some((h) => h.evaluation.source === "ai") ? "ai" : "rules";
  const report = buildReport(cfg, history, source);
  await db
    .update(schema.interviews)
    .set({ status: "completed", report, overallScore: report.overall, currentQuestion: null, completedAt: new Date() })
    .where(eq(schema.interviews.id, id));
  return report;
}

/**
 * The candidate's answer to "Do you have any questions for me?": the interviewer replies, and
 * the report notes how it would land. Only once, and only after the last answer.
 */
export async function closeInterview(userId: string, id: string, question: string) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.status !== "completed" || !row.report) throw new ConflictError("Finish the interview first.");
  if (row.report.closing) return row.report.closing;
  const rules = closingRules(question);
  let closing = { question: question.trim().slice(0, 1000), ...rules };
  if (row.provider === "ai" && aiEnabled() && rules.asked) {
    try {
      closing = { ...closing, ...(await closingWithAI(configOf(row), question)) };
    } catch (err) {
      console.warn("[ai] closing reply failed:", (err as Error).message);
    }
  }
  // Re-read just before writing, so a report finalised meanwhile is kept.
  const [latest] = await db.select({ report: schema.interviews.report }).from(schema.interviews).where(eq(schema.interviews.id, id));
  await db.update(schema.interviews).set({ report: { ...(latest?.report ?? row.report), closing } }).where(eq(schema.interviews.id, id));
  return closing;
}

export async function deleteInterview(userId: string, id: string) {
  const db = await getDb();
  await owned(userId, id);
  await db.delete(schema.interviews).where(eq(schema.interviews.id, id));
}

/** Every answer this user has given, as evidence for the mastery model. */
export async function getMastery(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ questionId: schema.turns.questionId, evaluation: schema.turns.evaluation, at: schema.turns.createdAt })
    .from(schema.turns)
    .innerJoin(schema.interviews, eq(schema.turns.interviewId, schema.interviews.id))
    .where(eq(schema.interviews.userId, userId));
  const evidence = rows.map((r) => ({ questionId: r.questionId, score: r.evaluation.score, at: new Date(r.at).getTime() }));
  const topics = estimateMastery(evidence);
  return { topics, answers: evidence.length };
}
