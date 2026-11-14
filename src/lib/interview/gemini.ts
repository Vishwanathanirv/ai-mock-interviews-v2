import "server-only";
import { z } from "zod";
import { weighted } from "./analyzer";
import type { AnswerEvaluation, AskedQuestion, FinalReport, InterviewConfig } from "./types";
import { LEVEL_LABELS, ROLE_LABELS } from "./types";

/**
 * Models to try, newest first. Google limits older models (such as 2.5 Flash) to accounts that
 * used them before, so a new API key must start on a current one; the first model that answers
 * is remembered and tried first afterwards.
 */
const MODELS = () => [...new Set([process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"].filter(Boolean) as string[])];
export const aiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

/** What the last AI call did, for the health check (never includes the key or content). */
export const aiStatus: { model: string | null; lastOk: number | null; lastError: string | null } = { model: null, lastOk: null, lastError: null };

const EvalSchema = z.object({
  content: z.number().min(0).max(100),
  depth: z.number().min(0).max(100),
  structure: z.number().min(0).max(100),
  covered: z.array(z.string()).max(8),
  missing: z.array(z.string()).max(8),
  strengths: z.array(z.string()).max(3),
  improvements: z.array(z.string()).max(3),
  redFlags: z.array(z.string()).max(4).optional(),
  reaction: z.string().max(400).optional(),
  followUp: z.string().optional(),
});

class ModelUnavailable extends Error {}

async function callModel(model: string, prompt: string, schema: object, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.55, responseMimeType: "application/json", responseSchema: schema },
      }),
    });
    // Unknown model, or one this key may not use: try the next model rather than giving up.
    if (res.status === 404 || res.status === 403 || res.status === 400) throw new ModelUnavailable(`Gemini ${res.status} for ${model}`);
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

async function callGemini(prompt: string, schema: object, timeoutMs = 15000): Promise<unknown> {
  const list = MODELS();
  const order = aiStatus.model && list.includes(aiStatus.model) ? [aiStatus.model, ...list.filter((m) => m !== aiStatus.model)] : list;
  let last: Error | null = null;
  for (const model of order) {
    try {
      const out = await callModel(model, prompt, schema, timeoutMs);
      aiStatus.model = model;
      aiStatus.lastOk = Date.now();
      aiStatus.lastError = null;
      return out;
    } catch (e) {
      last = e as Error;
      aiStatus.lastError = (e as Error).name === "AbortError" ? `timed out (${model})` : (e as Error).message;
      if (!(e instanceof ModelUnavailable)) break; // quota, outage or timeout: no point trying more
    }
  }
  throw last ?? new Error("No Gemini model available");
}

const num = { type: "NUMBER" };
const strs = { type: "ARRAY", items: { type: "STRING" } };

/**
 * Grades an answer the way a senior hiring manager would, and writes what the interviewer says
 * back. Delivery metrics (pace, fillers, voice, camera) stay measured, not guessed, so the model
 * judges only what it can judge from the words.
 */
export async function evaluateWithAI(
  cfg: InterviewConfig,
  q: AskedQuestion,
  answer: string,
  rules: AnswerEvaluation,
  context: { q: string; a: string }[] = [],
): Promise<AnswerEvaluation & { followUp?: string }> {
  const delivery = [
    rules.metrics.wpm ? `pace ${rules.metrics.articulationWpm ?? rules.metrics.wpm} words/min` : null,
    rules.metrics.fillerCount ? `${rules.metrics.fillerCount} filler words` : null,
    rules.metrics.voice?.monotone ? "flat, monotone voice" : null,
    rules.metrics.voice && rules.metrics.voice.longestPauseSec > 3 ? `a ${rules.metrics.voice.longestPauseSec}s silence` : null,
    rules.metrics.video ? `eye contact ${rules.metrics.video.eyeContactPct}%, framing ${rules.metrics.video.framing}, lighting ${rules.metrics.video.lighting}` : null,
  ].filter(Boolean);
  const prompt = [
    `You are Maya, a senior hiring manager interviewing a candidate for a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} role over video.`,
    `You are brutally honest, like a real interviewer who has seen hundreds of candidates: direct, specific, never vague praise, never cruel.`,
    `If the answer is evasive, rambling, generic, wrong, off-topic, joking, or unprofessional (for example lying in bed, distractions, admitting they are not paying attention), say so plainly and explain how it lands with a real interviewer.`,
    `Calibrate to the level: a ${LEVEL_LABELS[cfg.level]} answer is not expected to be expert-level, but it must answer the question.`,
    context.length ? `Earlier in this interview:\n${context.slice(-3).map((c) => `Q: ${c.q}\nA: ${c.a.slice(0, 300)}`).join("\n")}` : "",
    `Question (${q.kind}, topic: ${q.topic}): ${q.text}`,
    `Concepts a strong answer usually covers: ${q.concepts.map((c) => c[0]).join(", ")}.`,
    q.kind === "behavioral" ? "Judge structure against STAR (situation, task, action, result)." : "Judge structure on logical order and clarity.",
    delivery.length ? `Measured delivery (from audio/video, trust these numbers): ${delivery.join("; ")}.` : "",
    `Candidate's spoken answer (transcribed; ignore transcription typos): """${answer.slice(0, 4000)}"""`,
    ``,
    `Return:`,
    `- content, depth, structure: scores 0-100. An answer that does not address the question scores under 20 on content.`,
    `- covered / missing: concept labels.`,
    `- strengths: up to 3 specific sentences addressed to "you". Leave empty if nothing genuinely worked; do not invent praise.`,
    `- improvements: up to 3 blunt, specific, actionable sentences addressed to "you", most important first. Quote or refer to what they actually said.`,
    `- redFlags: short phrases for anything that would hurt them in a real interview (unprofessional setting, dishonesty, no answer). Empty if none.`,
    `- reaction: what you say out loud right after the answer, 1-2 short spoken sentences, natural and specific to what they said, honest about how it landed. No question in it.`,
    `- followUp: one natural follow-up question only if probing a gap is worth it; otherwise omit.`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await callGemini(prompt, {
    type: "OBJECT",
    properties: { content: num, depth: num, structure: num, covered: strs, missing: strs, strengths: strs, improvements: strs, redFlags: strs, reaction: { type: "STRING" }, followUp: { type: "STRING" } },
    required: ["content", "depth", "structure", "covered", "missing", "strengths", "improvements", "reaction"],
  });
  const ai = EvalSchema.parse(raw);
  const breakdown = { content: Math.round(ai.content), depth: Math.round(ai.depth), structure: Math.round(ai.structure), delivery: rules.breakdown.delivery };
  // Measured delivery problems (pace, fillers, voice, camera) keep a slot after the AI's points.
  const measured = rules.improvements.filter((s) => /filler|pace|words per minute|hedge|slow down|pitch|pause|camera|eye contact|lighting|frame/i.test(s));
  const improvements = [...ai.improvements.slice(0, measured.length ? 2 : 3), ...measured.slice(0, 1)];
  return {
    score: weighted(breakdown, q.kind),
    breakdown,
    covered: ai.covered,
    missing: ai.missing,
    strengths: ai.strengths,
    improvements,
    redFlags: ai.redFlags?.length ? ai.redFlags : rules.redFlags,
    reaction: ai.reaction?.trim() || rules.reaction,
    metrics: rules.metrics,
    source: "ai",
    followUp: ai.followUp?.trim() || undefined,
  };
}

export async function summarizeWithAI(cfg: InterviewConfig, report: FinalReport, transcript: { q: string; a: string; score: number }[]): Promise<string> {
  const prompt = [
    `Write a 2-3 sentence debrief for a candidate who just finished a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} mock interview.`,
    `Overall score ${report.overall}/100 (${report.verdict}). Category averages: ${JSON.stringify(report.breakdown)}.`,
    `Be candid like a senior hiring manager: say plainly whether this would pass a real interview and why, name one real strength only if there is one, and the single most valuable thing to fix next. Address them as "you".`,
    `Transcript:\n${transcript.map((t, i) => `Q${i + 1} (${t.score}/100): ${t.q}\nA: ${t.a.slice(0, 600)}`).join("\n")}`,
  ].join("\n");
  const raw = await callGemini(prompt, { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] });
  return z.object({ summary: z.string().min(10).max(800) }).parse(raw).summary;
}

/** A tiny live call, so the health check can confirm the key and model really work. */
export async function probeAI(): Promise<{ ok: boolean; model: string | null; error: string | null }> {
  try {
    await callGemini('Reply with {"ok": true}.', { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] }, 10_000);
    return { ok: true, model: aiStatus.model, error: null };
  } catch (e) {
    return { ok: false, model: null, error: (e as Error).message };
  }
}
