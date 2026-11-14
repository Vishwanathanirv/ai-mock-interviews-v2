import "server-only";
import { z } from "zod";
import { weighted } from "./analyzer";
import type { AnswerEvaluation, AskedQuestion, FinalReport, InterviewConfig } from "./types";
import { LEVEL_LABELS, ROLE_LABELS, ROLE_TEAMS, type Level } from "./types";

/** What a panel expects at each level, so grading is calibrated rather than one-size-fits-all. */
const LEVEL_BAR: Record<Level, string> = {
  intern: "correct fundamentals in their own words and a willingness to reason; gaps are fine if they think out loud",
  junior: "correct fundamentals, one concrete example from their own work, and a sensible approach",
  mid: "real experience: specific examples, trade-offs, debugging steps and what they would do differently",
  senior: "depth and judgement: trade-offs at scale, failure modes, measurable impact, and how they lead or influence others",
};

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
    rules.metrics.video ? `eye contact ${rules.metrics.video.eyeContactPct}%, face visible ${rules.metrics.video.faceVisiblePct}%, head tilted or lying down ${rules.metrics.video.tiltedPct ?? 0}% of the time, framing ${rules.metrics.video.framing}, lighting ${rules.metrics.video.lighting}` : null,
  ].filter(Boolean);
  const prompt = [
    `You are Arjun, a senior hiring manager interviewing a candidate for a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} role over video.`,
    `You are brutally honest, like a real interviewer who has seen hundreds of candidates: direct, specific, never vague praise, never cruel.`,
    `If the answer is evasive, rambling, generic, wrong, off-topic, joking, or unprofessional (for example lying in bed, distractions, admitting they are not paying attention), say so plainly and explain how it lands with a real interviewer.`,
    `Calibrate to the level. A ${LEVEL_LABELS[cfg.level]} panel expects ${LEVEL_BAR[cfg.level]}.`,
    `Score anchors (for this level): 90-100 would impress the panel; 70-89 a clear pass; 55-69 borderline; 35-54 below the bar; under 35 did not really answer. Most answers in real interviews land between 45 and 75; do not inflate.`,
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
    `- reaction: what you say out loud right after the answer, as a real interviewer in the room: one short, natural spoken sentence. Real interviewers keep their verdict to themselves, so do NOT grade, praise heavily, or list what was missing (that goes in the written feedback). Neutral acknowledgements are normal ("Okay, thanks.", "Right, that makes sense."). Two exceptions: if their conduct is a problem (lying in bed, distractions, joking, refusing), address it directly and politely on the spot; if the answer was very thin, you may say briefly that you'd have liked more detail. No question in it.`,
    `- followUp: one natural follow-up question only if probing a gap is worth it; otherwise omit.`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await callGemini(prompt, {
    type: "OBJECT",
    properties: { content: num, depth: num, structure: num, covered: strs, missing: strs, strengths: strs, improvements: strs, redFlags: strs, reaction: { type: "STRING" }, followUp: { type: "STRING" } },
    required: ["content", "depth", "structure", "covered", "missing", "strengths", "improvements", "reaction"],
  }, 9000); // a live conversation can't wait longer; the rules grader takes over
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
    // What the camera saw is measured, not judged, so its red flags always stand, and the
    // interviewer addresses them out loud the way a real one would.
    redFlags: [...new Set([...(ai.redFlags ?? []), ...(rules.redFlags ?? [])])],
    reaction: rules.redFlags?.some((f) => f === "not sitting upright" || f === "out of the camera view") ? rules.reaction : ai.reaction?.trim() || rules.reaction,
    metrics: rules.metrics,
    source: "ai",
    followUp: ai.followUp?.trim() || undefined,
  };
}

export async function summarizeWithAI(cfg: InterviewConfig, report: FinalReport, transcript: { q: string; a: string; score: number }[]): Promise<string> {
  const prompt = [
    `You were the interviewer for a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} interview. Write the 3-4 sentence feedback you would give the candidate after the hiring panel met.`,
    `Overall score ${report.overall}/100 against a bar of ${report.decision?.bar ?? "?"}. Panel decision: ${report.decision?.call ?? report.verdict}. Category averages: ${JSON.stringify(report.breakdown)}.`,
    `Be brutally honest and specific, like a senior hiring manager who respects them enough to tell the truth: state the decision and the main reason for it, quote or point to a specific answer, name one real strength only if there is one, and the single most valuable thing to fix before a real interview. Address them as "you". No sugar-coating, no cruelty.`,
    `Transcript:\n${transcript.map((t, i) => `Q${i + 1} (${t.score}/100): ${t.q}\nA: ${t.a.slice(0, 600)}`).join("\n")}`,
  ].join("\n");
  const raw = await callGemini(prompt, { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] });
  return z.object({ summary: z.string().min(10).max(800) }).parse(raw).summary;
}

/**
 * The interviewer answers the candidate's own question at the end, briefly and in character,
 * and notes how the question would land with a real panel.
 */
export async function closingWithAI(cfg: InterviewConfig, question: string): Promise<{ reply: string; note: string }> {
  const prompt = [
    `You are Arjun, the hiring manager for ${ROLE_TEAMS[cfg.role]} at a mid-sized software company, finishing a ${LEVEL_LABELS[cfg.level]} ${ROLE_LABELS[cfg.role]} interview.`,
    `You asked "Do you have any questions for me?" and the candidate said: """${question.slice(0, 1000)}"""`,
    `Return:`,
    `- reply: what you say back out loud, 1-3 short natural sentences. Answer plausibly about a typical team like yours (do not invent a real company name). If they had no question, say that's fine. End warmly but briefly.`,
    `- note: one or two honest sentences of feedback, addressed to "you", on how this would land with a real interviewer: thoughtful questions about the work, team or how success is measured help; no question, or leading with salary or time off in a first round, can read as low interest.`,
  ].join("\n");
  const raw = await callGemini(prompt, { type: "OBJECT", properties: { reply: { type: "STRING" }, note: { type: "STRING" } }, required: ["reply", "note"] });
  return z.object({ reply: z.string().min(2).max(600), note: z.string().min(5).max(500) }).parse(raw);
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
