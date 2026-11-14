import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { VideoMetrics } from "@/lib/video/analysis";
import type { VoiceMetrics } from "@/lib/voice/prosody";
import { scoreAnswer } from "./analyzer";
import { estimateMastery } from "./mastery";
import { findQuestion } from "./bank";
import { closingRules } from "./closing";
import { aiEnabled, closingWithAI, evaluateWithAI, summarizeWithAI } from "./gemini";
import { buildReport, firstQuestion, pickNext } from "./planner";
import type { AnswerEvaluation, AskedQuestion, HistoryItem, InterviewConfig, Role, Level, Focus } from "./types";

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
  const db = await getDb();
  const [row] = await db.select().from(schema.interviews).where(and(eq(schema.interviews.id, id), eq(schema.interviews.userId, userId)));
  if (!row) throw new NotFoundError("Interview not found");
  return row;
}

async function historyOf(id: string): Promise<{ turns: schema.Turn[]; history: HistoryItem[] }> {
  const db = await getDb();
  const turns = await db.select().from(schema.turns).where(eq(schema.turns.interviewId, id)).orderBy(asc(schema.turns.idx));
  const history = turns.map((t) => {
    const parentId = t.isFollowUp ? t.questionId.replace(/:probe$/, "") : undefined;
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

/** Grades one answer, stores it, and returns the next question (or null when the interview is over). */
export async function submitAnswer(userId: string, id: string, answer: string, durationSec: number, voice?: VoiceMetrics, video?: VideoMetrics) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.status !== "active" || !row.currentQuestion) throw new ConflictError("This interview is already finished.");
  const cfg = configOf(row);
  const q = row.currentQuestion;
  const { history } = await historyOf(id);

  const rules = scoreAnswer(q, answer, durationSec, voice, video);
  let evaluation: AnswerEvaluation = rules;
  let aiFollowUp: string | undefined;
  if (row.provider === "ai" && aiEnabled()) {
    try {
      const ai = await evaluateWithAI(cfg, q, answer, rules, history.map((h) => ({ q: h.question.text, a: h.answer })));
      aiFollowUp = ai.followUp;
      const { followUp: _omit, ...rest } = ai;
      void _omit;
      // Measurements always come from the analyser, whoever does the grading.
      evaluation = { ...rest, metrics: rules.metrics };
    } catch (err) {
      console.warn("[ai] evaluation failed, using rule-based scoring:", (err as Error).message);
      evaluation = { ...rules, source: "rules" };
    }
  }

  try {
    await db.insert(schema.turns).values({
      interviewId: id,
      idx: history.length,
      questionId: q.id,
      question: q.text,
      kind: q.kind,
      isFollowUp: q.isFollowUp ? 1 : 0,
      answer,
      durationSec,
      evaluation,
    });
  } catch {
    throw new ConflictError("That answer was already submitted.");
  }

  const full: HistoryItem[] = [...history, { question: q, answer, evaluation }];
  let next = pickNext(cfg, full, id);
  if (next?.isFollowUp && aiFollowUp) next = { ...next, text: aiFollowUp };
  await db.update(schema.interviews).set({ currentQuestion: next }).where(eq(schema.interviews.id, id));
  if (!next) await finishInterview(userId, id);
  return { evaluation, next, done: !next };
}

export async function finishInterview(userId: string, id: string) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.status === "completed" && row.report) return row.report;
  const cfg = configOf(row);
  const { history } = await historyOf(id);
  if (!history.length) throw new ConflictError("Answer at least one question first.");
  const source = history.some((h) => h.evaluation.source === "ai") ? "ai" : "rules";
  let report = buildReport(cfg, history, source);
  if (source === "ai" && aiEnabled()) {
    try {
      report = { ...report, summary: await summarizeWithAI(cfg, report, history.map((h) => ({ q: h.question.text, a: h.answer, score: h.evaluation.score }))) };
    } catch (err) {
      console.warn("[ai] summary failed:", (err as Error).message);
    }
  }
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
  await db.update(schema.interviews).set({ report: { ...row.report, closing } }).where(eq(schema.interviews.id, id));
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
