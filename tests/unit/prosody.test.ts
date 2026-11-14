import { describe, expect, it } from "vitest";
import { ProsodyTracker, yin } from "@/lib/voice/prosody";
import { scoreAnswer } from "@/lib/interview/analyzer";
import type { AskedQuestion } from "@/lib/interview/types";

/**
 * A voice-like test signal: a glottal-style harmonic series (energy falling with harmonic number)
 * whose pitch follows `f0(t)`, with optional silences, plus a little room noise.
 */
function voice(rate: number, seconds: number, f0: (t: number) => number, silent: (t: number) => boolean = () => false, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5);
  const out = new Float32Array(Math.round(rate * seconds));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * f0(t)) / rate;
    let v = 0;
    if (!silent(t)) for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
    out[i] = v * 0.15 + rnd() * 0.002;
  }
  return out;
}

function analyse(sig: Float32Array, rate: number) {
  const t = new ProsodyTracker(rate);
  for (let i = 0; i < sig.length; i += 2048) t.push(sig.subarray(i, i + 2048));
  return t.summary();
}

describe("YIN pitch", () => {
  for (const rate of [16000, 44100, 48000])
    for (const f of [85, 110, 165, 240, 330])
      it(`finds ${f} Hz at ${rate} Hz within 1%`, () => {
        const frame = voice(rate, 0.06, () => f).subarray(0, Math.ceil((rate / 65) * 2.2));
        const got = yin(frame, rate);
        expect(got).not.toBeNull();
        expect(Math.abs(got! - f) / f).toBeLessThan(0.01);
      });

  it("does not report a pitch for noise or silence", () => {
    let s = 9;
    const noise = new Float32Array(2048).map(() => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.3);
    expect(yin(noise, 16000)).toBeNull();
    expect(yin(new Float32Array(2048), 16000)).toBeNull();
  });
});

describe("voice summary", () => {
  it("measures pitch variety in semitones: lively speech vs a flat voice", () => {
    const rate = 16000;
    // ±4 semitone intonation contour, 0.7 Hz: lively. A 0.3 semitone wobble: flat.
    const lively = analyse(voice(rate, 8, (t) => 120 * 2 ** ((4 * Math.sin(2 * Math.PI * 0.7 * t)) / 12)), rate);
    const flat = analyse(voice(rate, 8, (t) => 120 * 2 ** ((0.3 * Math.sin(2 * Math.PI * 0.7 * t)) / 12)), rate);
    expect(lively.pitchMedianHz).toBeGreaterThan(110);
    expect(lively.pitchMedianHz).toBeLessThan(130);
    expect(lively.pitchSdSemitones!).toBeGreaterThan(2.5);
    expect(lively.monotone).toBe(false);
    expect(flat.pitchSdSemitones!).toBeLessThan(0.5);
    expect(flat.monotone).toBe(true);
  });

  it("counts pauses between speech and ignores silence before the first word", () => {
    const rate = 48000;
    const gaps = (t: number) => t < 1.5 || (t > 4 && t < 6.5) || (t > 9 && t < 9.4) || (t > 12 && t < 13);
    const m = analyse(voice(rate, 15, () => 140, gaps), rate);
    expect(m.pauses).toBe(2); // 2.5 s and 1 s; the 0.4 s gap is just a breath
    expect(m.longestPauseSec).toBeGreaterThan(2.2);
    expect(m.longestPauseSec).toBeLessThan(2.8);
    expect(m.speakingSec).toBeGreaterThan(9.5);
    expect(m.speakingSec).toBeLessThan(10.6);
  });

  it("reports nothing useful for a silent recording", () => {
    const m = analyse(new Float32Array(16000 * 3), 16000);
    expect(m.speakingSec).toBe(0);
    expect(m.monotone).toBeNull();
  });
});

describe("voice-aware scoring", () => {
  const q: AskedQuestion = { id: "b1", kind: "behavioral", topic: "teamwork", difficulty: 1, text: "Tell me about a time…", concepts: [["result"]], isFollowUp: false };
  const answer = "When I joined the team our deploys took forty minutes. My task was to cut that down, so I rebuilt the pipeline with caching. As a result deploys take six minutes.";
  const base = { durationSec: 20, speakingSec: 14, pauses: 1, longestPauseSec: 0.9, pauseRatio: 0.12, pitchMedianHz: 120, pitchSdSemitones: 2.6, pitchRangeSemitones: 6.5, monotone: false, loudnessSdDb: 4, voicedFrames: 300 };

  it("uses speaking time, not wall time, for pace", () => {
    const e = scoreAnswer(q, answer, 20, base);
    expect(e.metrics.articulationWpm).toBe(Math.round((e.metrics.words / 14) * 60));
  });

  it("lowers delivery for a flat voice and a long silence, and says why", () => {
    const good = scoreAnswer(q, answer, 20, base);
    const flat = scoreAnswer(q, answer, 20, { ...base, monotone: true, pitchSdSemitones: 0.9, pitchRangeSemitones: 2.1, longestPauseSec: 5.5 });
    expect(flat.breakdown.delivery).toBeLessThan(good.breakdown.delivery);
    expect(flat.improvements.join(" ")).toMatch(/semitones/);
    expect(good.strengths.join(" ")).toMatch(/Expressive voice/);
  });
});
