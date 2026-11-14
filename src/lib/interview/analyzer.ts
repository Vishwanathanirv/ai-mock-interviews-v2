import { videoTips, type VideoMetrics } from "@/lib/video/analysis";
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

export function analyzeDelivery(answer: string, durationSec: number, voice?: VoiceMetrics, video?: VideoMetrics): DeliveryMetrics {
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
    ...(video && video.frames >= 5 ? { video } : {}),
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Things a real interviewer would react to before anything else: an unprofessional setting,
 * not engaging with the question, or brushing it off.
 */
const RED_FLAGS: { re: RegExp; flag: string; advice: string }[] = [
  {
    re: /\b(lying (down|in bed|on (my|the) (bed|couch|sofa))|in (my )?bed|half asleep|just woke up|eating (right now|now)|roommate|room ?mate|(playing|watching) (bgmi|pubg|valorant|fortnite|cod|free ?fire|games?|netflix|tv|youtube))\b/i,
    flag: "unprofessional setting",
    advice: "You told the interviewer about your setting (lying down, distractions around you). In a real interview that alone can end it: sit upright at a desk, in a quiet room, and treat the call like an in-person meeting.",
  },
  {
    re: /^\W*(i don'?t know|no idea|idk|pass|skip|nothing( much)?|not sure|can'?t say|no comment)\b/i,
    flag: "no real answer",
    advice: "You didn't attempt the question. Even when you don't know, reason out loud: say what you do know, how you would find out, and take a best guess.",
  },
  {
    re: /\b(lol|lmao|whatever|bruh|bro,|just kidding|jk)\b/i,
    flag: "dismissive tone",
    advice: "The tone came across as casual and dismissive. Interviewers read that as not taking the role seriously.",
  },
];

export function detectRedFlags(answer: string): { flags: string[]; advice: string[] } {
  const hits = RED_FLAGS.filter((r) => r.re.test(answer));
  return { flags: hits.map((h) => h.flag), advice: hits.map((h) => h.advice) };
}

/** Deterministic choice so the same answer gets the same line, but different answers vary. */
const pick = <T,>(xs: T[], key: string) => {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return xs[Math.abs(h) % xs.length];
};

/** What the interviewer says right after an answer when grading without AI. Honest, short, specific. */
export function rulesReaction(q: AskedQuestion, e: Pick<AnswerEvaluation, "score" | "covered" | "missing" | "redFlags" | "metrics">, answer: string): string {
  if (e.redFlags?.includes("unprofessional setting")) return pick(["I'll be honest: telling an interviewer you're lying down with a game going on behind you would end most interviews right there.", "Honestly, that setting would cost you this job before your answer even mattered. Let's treat this like the real thing."], answer);
  if (e.redFlags?.includes("no real answer")) return pick(["That's not an answer I can work with. In a real interview, think out loud rather than passing.", "I need you to at least attempt it. Saying you don't know and stopping is the weakest possible answer."], answer);
  if (e.metrics.words < 15) return pick(["That was very short. I don't have enough to judge you on.", "That's too brief. An interviewer would assume you don't know much about this."], answer);
  if (e.score >= 75) return pick([`Good. ${e.covered[0] ? `Bringing in ${e.covered[0]} was the right call.` : "That was clear and specific."}`, "That's a solid answer, clear and to the point.", `Nice. That's the kind of detail I was looking for.`], answer);
  if (e.score >= 50) return e.missing[0] ? pick([`Okay. That's partly there, but you never got to ${e.missing[0]}.`, `Alright. Decent start, though I was waiting to hear about ${e.missing[0]}.`], answer) : "Okay. It's fine, but it needs more specifics to stand out.";
  return e.missing.length ? pick([`Honestly, that didn't really answer the question. I was listening for ${e.missing.slice(0, 2).join(" and ")}.`, `That missed the point of the question. The key was ${e.missing[0]}.`], answer) : "Honestly, that didn't land. It was too vague to show me what you can do.";
}

/** Transparent, rule-based scoring used offline and to ground AI scores with measurable delivery data. */
export function scoreAnswer(question: AskedQuestion, answer: string, durationSec: number, voice?: VoiceMetrics, video?: VideoMetrics): AnswerEvaluation {
  const norm = normalize(answer);
  const metrics = analyzeDelivery(answer, durationSec, voice, video);
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
  // On camera: eye contact and a settled posture.
  const cam = metrics.video;
  if (cam && cam.faceVisiblePct >= 50) {
    if (cam.eyeContactPct < 50) delivery -= Math.min(10, (50 - cam.eyeContactPct) / 4);
    if (cam.movement > 0.35) delivery -= 4;
  }
  if (metrics.words < 15) delivery = Math.min(delivery, 40);

  const red = detectRedFlags(answer);
  // A non-answer or an unprofessional setting caps the score, however many keywords slip in.
  const capped = red.flags.includes("no real answer") || red.flags.includes("unprofessional setting");
  const breakdown: ScoreBreakdown = capped
    ? { content: Math.min(content, 15), depth: Math.min(depth, 20), structure: Math.min(structure, 20), delivery: Math.min(clamp(delivery), 40) }
    : { content, depth, structure, delivery: clamp(delivery) };
  const score = weighted(breakdown, question.kind);
  const fb = feedback(question, metrics, breakdown, covered, missing);
  const improvements = [...red.advice, ...fb.improvements].slice(0, 3);
  const strengths = capped ? fb.strengths.filter((s) => !/^Stayed on the question/.test(s)) : fb.strengths;
  const base = { score, breakdown, covered, missing, strengths, improvements, metrics, source: "rules" as const, ...(red.flags.length ? { redFlags: red.flags } : {}) };
  return { ...base, reaction: rulesReaction(question, base, answer) };
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
  const cam = m.video ? videoTips(m.video) : { strengths: [], improvements: [] };
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
  if (!strengths.length && covered.length) strengths.push(`You did touch on ${covered[0]}.`);
  // What the microphone heard gets one of the three slots, so it is never crowded out.
  // Presence (voice, then camera) gets one of the three slots, so it is never crowded out.
  const presence = [...fromVoice, ...cam.improvements];
  const presenceStrength = voiceStrength ?? cam.strengths[0] ?? null;
  const strengthsOut = presenceStrength ? [...strengths.slice(0, 2), presenceStrength] : strengths.slice(0, 3);
  return { strengths: strengthsOut, improvements: [...improvements.slice(0, presence.length ? 2 : 3), ...presence.slice(0, 1)] };
}
