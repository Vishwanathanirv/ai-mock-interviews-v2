import type { VoiceMetrics } from "@/lib/voice/prosody";
import type { AnswerEvaluation, AskedQuestion, Concept, DeliveryMetrics, ScoreBreakdown } from "./types";

const FILLERS = ["um", "uh", "erm", "hmm", "like", "you know", "basically", "actually", "kind of", "sort of", "i mean", "literally"];
const HEDGES = ["i think", "maybe", "probably", "i guess", "not sure", "perhaps", "i believe"];
const CONNECTORS = ["first", "second", "then", "next", "finally", "because", "so that", "therefore", "however", "for example", "for instance", "as a result", "which means"];

export function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9+#.\-/' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function countPhrase(norm: string, phrase: string): number {
  const re = new RegExp(`(?<![a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g");
  return (norm.match(re) ?? []).length;
}

/** "like" only counts as a filler when it is not used as a verb/preposition ("I like", "looks like"). */
function countLikeFiller(norm: string): number {
  const re = /(?:^|[ ,])like(?=[ ,])/g;
  let n = 0;
  for (const m of norm.matchAll(re)) {
    const before = norm.slice(Math.max(0, m.index - 12), m.index);
    if (!/(i|you|we|they|would|looks|feel|feels|something|just|things)\s*$/.test(before)) n++;
  }
  return n;
}

export function conceptHit(norm: string, concept: Concept): boolean {
  return concept.some((alt) => {
    const a = alt.toLowerCase();
    // Prefix stems such as "prioriti" or "communicat" match any word that starts with them.
    if (!a.includes(" ") && a.length >= 7 && !/[^a-z]/.test(a)) return new RegExp(`(?<![a-z])${a}`).test(norm);
    return countPhrase(norm, a) > 0;
  });
}

export function analyzeDelivery(answer: string, durationSec: number, voice?: VoiceMetrics): DeliveryMetrics {
  const norm = normalize(answer);
  const words = norm.trim() ? norm.trim().split(" ").length : 0;
  const fillers: Record<string, number> = {};
  for (const f of FILLERS) {
    const n = f === "like" ? countLikeFiller(norm) : countPhrase(norm, f);
    if (n) fillers[f] = n;
  }
  const fillerCount = Object.values(fillers).reduce((a, b) => a + b, 0);
  const sentences = answer.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const hedges = HEDGES.reduce((a, h) => a + countPhrase(norm, h), 0);
  return {
    words,
    wpm: durationSec >= 5 ? Math.round((words / durationSec) * 60) : null,
    fillerCount,
    fillerRate: words ? +(fillerCount / words).toFixed(3) : 0,
    fillers,
    avgSentenceWords: sentences.length ? Math.round(words / sentences.length) : words,
    hedges,
    hasNumbers: /\d/.test(answer) || /\b(percent|twice|half|thousand|million|hundred)\b/i.test(answer),
    hasExample: /\b(for example|for instance|in my project|at my|when i|i built|we built|e\.g\.)\b/i.test(answer),
    star: {
      situation: /\b(when|at the time|situation|context|while working|during)\b/i.test(answer),
      task: /\b(my (task|job|role|responsibility)|i (needed|had) to|goal was|asked to)\b/i.test(answer),
      action: /\b(i (built|wrote|decided|implemented|fixed|created|led|designed|talked|reached|set up|changed|added))\b/i.test(answer),
      result: /\b(result|as a result|outcome|reduced|increased|improved|saved|shipped|launched|delivered|learned)\b/i.test(answer),
    },
    ...(voice && voice.speakingSec >= 3 ? { voice, articulationWpm: Math.round((words / voice.speakingSec) * 60) } : {}),
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Transparent, rule-based scoring used offline and to ground AI scores with measurable delivery data. */
export function scoreAnswer(question: AskedQuestion, answer: string, durationSec: number, voice?: VoiceMetrics): AnswerEvaluation {
  const norm = normalize(answer);
  const metrics = analyzeDelivery(answer, durationSec, voice);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const c of question.concepts) (conceptHit(norm, c) ? covered : missing).push(c[0]);
  const coverage = question.concepts.length ? covered.length / question.concepts.length : 0;

  // Content: concept coverage with a soft floor for on-topic but differently worded answers.
  const content = clamp(coverage * 90 + (metrics.words > 40 ? 10 : metrics.words / 4));

  // Depth: length sweet spot plus evidence of specifics.
  const lengthScore = metrics.words < 20 ? metrics.words * 2 : metrics.words < 60 ? 40 + (metrics.words - 20) : metrics.words <= 260 ? 80 : 80 - (metrics.words - 260) / 8;
  const depth = clamp(lengthScore + (metrics.hasNumbers ? 10 : 0) + (metrics.hasExample ? 10 : 0));

  // Structure: STAR for behavioural answers, signposting for technical ones.
  const connectors = CONNECTORS.filter((c) => countPhrase(norm, c) > 0).length;
  const starParts = Object.values(metrics.star).filter(Boolean).length;
  const structure = clamp(
    question.kind === "behavioral"
      ? starParts * 22 + Math.min(connectors, 3) * 4
      : 35 + Math.min(connectors, 5) * 11 + (metrics.avgSentenceWords > 0 && metrics.avgSentenceWords <= 28 ? 10 : 0),
  );

  // Delivery: pace, filler words, hedging.
  let delivery = 100;
  if (metrics.wpm !== null) {
    if (metrics.wpm < 100) delivery -= Math.min(30, (100 - metrics.wpm) * 0.6);
    if (metrics.wpm > 175) delivery -= Math.min(30, (metrics.wpm - 175) * 0.6);
  }
  delivery -= Math.min(35, metrics.fillerRate * 500);
  delivery -= Math.min(15, metrics.hedges * 4);
  // From the audio itself: a flat voice and long silences both read as uncertain.
  const v = metrics.voice;
  if (v) {
    if (v.monotone) delivery -= 8;
    if (v.longestPauseSec > 3) delivery -= Math.min(10, (v.longestPauseSec - 3) * 3);
    if (v.pauseRatio > 0.35) delivery -= Math.min(10, (v.pauseRatio - 0.35) * 40);
  }
  if (metrics.words < 15) delivery = Math.min(delivery, 40);

  const breakdown: ScoreBreakdown = { content, depth, structure, delivery: clamp(delivery) };
  const score = weighted(breakdown, question.kind);

  return { score, breakdown, covered, missing, ...feedback(question, metrics, breakdown, covered, missing), metrics, source: "rules" };
}

export function weighted(b: ScoreBreakdown, kind: "technical" | "behavioral"): number {
  const w = kind === "technical" ? { content: 0.45, depth: 0.25, structure: 0.15, delivery: 0.15 } : { content: 0.3, depth: 0.2, structure: 0.3, delivery: 0.2 };
  return clamp(b.content * w.content + b.depth * w.depth + b.structure * w.structure + b.delivery * w.delivery);
}

function feedback(q: AskedQuestion, m: DeliveryMetrics, b: ScoreBreakdown, covered: string[], missing: string[]) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  if (covered.length) strengths.push(q.kind === "technical" ? `Covered key ideas: ${covered.slice(0, 3).join(", ")}.` : `Clearly covered ${covered.slice(0, 2).join(" and ")}.`);
  if (m.hasExample) strengths.push("Grounded the answer in a concrete example.");
  if (m.hasNumbers) strengths.push("Used numbers to make the impact specific.");
  if (q.kind === "behavioral" && Object.values(m.star).every(Boolean)) strengths.push("Clear STAR structure: situation, task, action and result.");
  if (b.delivery >= 85 && m.words >= 30) strengths.push("Confident, fluent delivery with few filler words.");
  const voiceStrength = m.voice?.monotone === false && (m.voice.pitchSdSemitones ?? 0) >= 2.2 ? "Expressive voice: your pitch rose and fell naturally, which keeps listeners engaged." : null;

  if (missing.length) {
    const list = missing.slice(0, 3);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
    improvements.push(q.kind === "technical" ? `Bring in ${joined}; interviewers listen for these here.` : `Make the story complete: also cover ${joined}.`);
  }
  if (m.words < 40) improvements.push("Go deeper: aim for 60 to 180 words with one specific example.");
  if (m.words > 280) improvements.push("Tighten it up: lead with the main point, then support it.");
  if (!m.hasExample && m.words >= 20) improvements.push("Add a real example from a project you built.");
  if (q.kind === "behavioral") {
    const gaps = (Object.entries(m.star) as [string, boolean][]).filter(([, v]) => !v).map(([k]) => k);
    if (gaps.length) improvements.push(`Complete the STAR story: say more about the ${gaps.join(" and ")}.`);
  }
  if (m.fillerRate > 0.04) {
    const top = Object.entries(m.fillers).sort((a, b) => b[1] - a[1])[0]?.[0];
    improvements.push(`Cut filler words${top ? ` (especially "${top}")` : ""}; a short pause sounds more confident.`);
  }
  const pace = m.articulationWpm ?? m.wpm;
  if (pace != null && pace > 175) improvements.push(`Slow down a little: ${pace} words per minute${m.articulationWpm ? " of speaking time" : ""} is fast for an interview.`);
  if (m.wpm !== null && m.wpm < 95 && m.words > 20) improvements.push("Keep a steadier pace; long gaps can sound unsure.");
  if (m.hedges >= 2) improvements.push('Fewer hedges like "I think" or "maybe"; state what you know directly.');
  const fromVoice: string[] = [];
  if (m.voice?.monotone) fromVoice.push(`Your pitch stayed within about ${m.voice.pitchRangeSemitones} semitones, which can sound flat. Lift your voice on the key result and slow down on numbers.`);
  if (m.voice && m.voice.longestPauseSec > 3) fromVoice.push(`One pause lasted ${m.voice.longestPauseSec} s. If you need time, say "Let me think about that for a second" instead of going silent.`);
  if (!strengths.length) strengths.push("Stayed on the question and gave an answer to build on.");
  // What the microphone heard gets one of the three slots, so it is never crowded out.
  const strengthsOut = voiceStrength ? [...strengths.slice(0, 2), voiceStrength] : strengths.slice(0, 3);
  return { strengths: strengthsOut, improvements: [...improvements.slice(0, fromVoice.length ? 2 : 3), ...fromVoice.slice(0, 1)] };
}
