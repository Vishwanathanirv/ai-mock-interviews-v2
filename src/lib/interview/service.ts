import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoreAnswer } from "./analyzer";
import { findQuestion } from "./bank";
import { aiEnabled, evaluateWithAI, summarizeWithAI } from "./gemini";
import { buildReport, firstQuestion, pickNext } from "./planner";
import type { AnswerEvaluation, AskedQuestion, HistoryItem, InterviewConfig, Role, Level, Focus } from "./types";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const configOf = (i: schema.Interview): InterviewConfig => ({
  role: i.role as Role,
  level: i.level as Level,
  focus: i.focus as Focus,
  totalQuestions: i.totalQuestions,
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
    .values({ userId, ...cfg, provider, currentQuestion: null })
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
export async function submitAnswer(userId: string, id: string, answer: string, durationSec: number) {
  const db = await getDb();
  const row = await owned(userId, id);
  if (row.status !== "active" || !row.currentQuestion) throw new ConflictError("This interview is already finished.");
  const cfg = configOf(row);
  const q = row.currentQuestion;
  const { history } = await historyOf(id);

  const rules = scoreAnswer(q, answer, durationSec);
  let evaluation: AnswerEvaluation = rules;
  let aiFollowUp: string | undefined;
  if (row.provider === "ai" && aiEnabled()) {
    try {
      const ai = await evaluateWithAI(cfg, q, answer, rules);
      aiFollowUp = ai.followUp;
      const { followUp: _omit, ...rest } = ai;
      void _omit;
      evaluation = rest;
    } catch (err) {
      console.warn("[ai] evaluation failed, using rule-based scoring:", (err as Error).message);
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

export async function deleteInterview(userId: string, id: string) {
  const db = await getDb();
  await owned(userId, id);
  await db.delete(schema.interviews).where(eq(schema.interviews.id, id));
}
