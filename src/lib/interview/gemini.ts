import "server-only";
import { z } from "zod";
import { weighted } from "./analyzer";
import type { AnswerEvaluation, AskedQuestion, FinalReport, InterviewConfig } from "./types";
import { LEVEL_LABELS, ROLE_LABELS } from "./types";

const MODEL = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const aiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

const EvalSchema = z.object({
  content: z.number().min(0).max(100),
  depth: z.number().min(0).max(100),
  structure: z.number().min(0).max(100),
  covered: z.array(z.string()).max(8),
  missing: z.array(z.string()).max(8),
  strengths: z.array(z.string()).max(3),
  improvements: z.array(z.string()).max(3),
  followUp: z.string().optional(),
});

async function callGemini(prompt: string, schema: object, timeoutMs = 15000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: schema },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

const num = { type: "NUMBER" };
const strs = { type: "ARRAY", items: { type: "STRING" } };

/**
 * Asks Gemini to grade the content of an answer. Delivery metrics (pace, fillers) stay measured,
 * not guessed, so the model only judges what it can actually judge from text.
 */
export async function evaluateWithAI(cfg: InterviewConfig, q: AskedQuestion, answer: string, rules: AnswerEvaluation): Promise<AnswerEvaluation & { followUp?: string }> {
  const prompt = [
    `You are a fair, demanding interviewer for a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} role.`,
    `Grade the candidate's spoken answer (transcribed, so ignore transcription typos).`,
    `Question (${q.kind}, topic: ${q.topic}): ${q.text}`,
    `Concepts a strong answer usually covers: ${q.concepts.map((c) => c[0]).join(", ")}.`,
    q.kind === "behavioral" ? "Judge structure against STAR (situation, task, action, result)." : "Judge structure on logical order and clarity.",
    `Calibrate to the level: a ${LEVEL_LABELS[cfg.level]} answer is not expected to be expert-level.`,
    `Return scores 0-100 for content (correctness and coverage), depth (specifics, examples, trade-offs) and structure.`,
    `strengths and improvements: up to 3 short, specific sentences each, addressed to the candidate as "you".`,
    `followUp: one natural follow-up question only if a key gap is worth probing; otherwise omit it.`,
    `Candidate answer: """${answer.slice(0, 4000)}"""`,
  ].join("\n");
  const raw = await callGemini(prompt, {
    type: "OBJECT",
    properties: { content: num, depth: num, structure: num, covered: strs, missing: strs, strengths: strs, improvements: strs, followUp: { type: "STRING" } },
    required: ["content", "depth", "structure", "covered", "missing", "strengths", "improvements"],
  });
  const ai = EvalSchema.parse(raw);
  const breakdown = { content: Math.round(ai.content), depth: Math.round(ai.depth), structure: Math.round(ai.structure), delivery: rules.breakdown.delivery };
  const deliveryNotes = rules.improvements.filter((s) => /filler|pace|words per minute|hedge|slow down/i.test(s));
  return {
    score: weighted(breakdown, q.kind),
    breakdown,
    covered: ai.covered,
    missing: ai.missing,
    strengths: ai.strengths,
    improvements: [...ai.improvements, ...deliveryNotes].slice(0, 3),
    metrics: rules.metrics,
    source: "ai",
    followUp: ai.followUp?.trim() || undefined,
  };
}

export async function summarizeWithAI(cfg: InterviewConfig, report: FinalReport, transcript: { q: string; a: string; score: number }[]): Promise<string> {
  const prompt = [
    `Write a 2-3 sentence debrief for a candidate who just finished a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} mock interview.`,
    `Overall score ${report.overall}/100 (${report.verdict}). Category averages: ${JSON.stringify(report.breakdown)}.`,
    `Be honest and encouraging, mention one concrete strength and the single most valuable thing to practise next. Address them as "you".`,
    `Transcript:\n${transcript.map((t, i) => `Q${i + 1} (${t.score}/100): ${t.q}\nA: ${t.a.slice(0, 600)}`).join("\n")}`,
  ].join("\n");
  const raw = await callGemini(prompt, { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] });
  return z.object({ summary: z.string().min(10).max(800) }).parse(raw).summary;
}
