/**
 * Voice analytics from the microphone signal itself, not the transcript: how much of the time the
 * candidate was actually speaking, where they paused, how varied their pitch was, and how steady
 * their volume stayed. Everything runs in the browser on raw samples; only these numbers are sent.
 *
 * Pitch uses the YIN estimator (de Cheveigné & Kawahara, 2002). Speech activity uses an adaptive
 * noise floor, so it works in a quiet room and a noisy one.
 */

export type VoiceMetrics = {
  durationSec: number;
  speakingSec: number;
  /** Silences of 0.6 s or more between stretches of speech. */
  pauses: number;
  longestPauseSec: number;
  /** Share of the answer (first word to last) spent silent. */
  pauseRatio: number;
  pitchMedianHz: number | null;
  /** Standard deviation of pitch in semitones around the median: under ~1.6 sounds flat. */
  pitchSdSemitones: number | null;
  /** 10th to 90th percentile pitch range, in semitones. */
  pitchRangeSemitones: number | null;
  monotone: boolean | null;
  /** Standard deviation of loudness while speaking, in dB. */
  loudnessSdDb: number | null;
  voicedFrames: number;
};

export type YinOptions = { fmin?: number; fmax?: number; threshold?: number };

/**
 * Fundamental frequency of one frame, or null when the frame is not clearly voiced.
 * Steps: difference function, cumulative mean normalisation, absolute threshold, parabolic
 * interpolation around the chosen lag.
 */
export function yin(frame: Float32Array, sampleRate: number, opts: YinOptions = {}): number | null {
  const { fmin = 65, fmax = 420, threshold = 0.15 } = opts;
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
  const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(frame.length / 2));
  if (tauMax <= tauMin + 2) return null;
  const W = frame.length - tauMax;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const diff = frame[i] - frame[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation for sub-sample precision.
  const a = cmnd[tau - 1] ?? cmnd[tau];
  const b = cmnd[tau];
  const c = cmnd[tau + 1] ?? cmnd[tau];
  const denom = a + c - 2 * b;
  const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
  const f0 = sampleRate / (tau + Math.max(-1, Math.min(1, shift)));
  return f0 >= fmin && f0 <= fmax ? f0 : null;
}

const db = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-7));

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

type Frame = { t: number; level: number; f0: number | null };

/**
 * Collects frames during an answer and summarises them. Feed it consecutive, non-overlapping
 * chunks of mono samples (any chunk size); it frames them into 40 ms hops internally.
 */
export class ProsodyTracker {
  private frames: Frame[] = [];
  private buf: number[] = [];
  private t = 0;
  private readonly hop: number;
  private readonly win: number;
  private pitchEvery = 1;
  private n = 0;

  constructor(readonly sampleRate: number) {
    this.hop = Math.round(sampleRate * 0.04);
    // Long enough for two periods of a 65 Hz voice.
    this.win = Math.max(this.hop, Math.ceil((sampleRate / 65) * 2.2));
    // Pitch every frame up to 24 kHz; every other frame above, to keep CPU low on 48 kHz mics.
    if (sampleRate > 24_000) this.pitchEvery = 2;
  }

  push(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) this.buf.push(samples[i]);
    while (this.buf.length >= this.win) {
      const frame = Float32Array.from(this.buf.slice(0, this.win));
      let s = 0;
      for (let i = 0; i < this.hop; i++) s += frame[i] * frame[i];
      const level = db(Math.sqrt(s / this.hop));
      const f0 = this.n++ % this.pitchEvery === 0 && level > -55 ? yin(frame, this.sampleRate) : null;
      this.frames.push({ t: this.t, level, f0 });
      this.t += this.hop / this.sampleRate;
      this.buf.splice(0, this.hop);
    }
    if (this.frames.length > 60 * 60 * 25) this.frames.splice(0, this.frames.length - 60 * 60 * 25); // keep an hour at most
  }

  /** Per-frame speech/non-speech decisions with an adaptive floor and 200 ms hangover. */
  private activity(): boolean[] {
    const levels = this.frames.map((f) => f.level).sort((a, b) => a - b);
    const floor = percentile(levels, 0.1);
    const peak = percentile(levels, 0.95);
    // Halfway between the noise floor and loud speech, but at least 10 dB above the floor.
    const threshold = Math.max(floor + 10, Math.min(peak - 6, (floor + peak) / 2), -60);
    const raw = this.frames.map((f) => f.level > threshold || f.f0 !== null);
    const hang = 5; // frames (200 ms): bridges gaps between syllables
    const out = raw.slice();
    let last = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i]) last = i;
      else if (i - last <= hang) out[i] = true;
    }
    return out;
  }

  summary(): VoiceMetrics {
    const hop = this.hop / this.sampleRate;
    const durationSec = +(this.frames.length * hop).toFixed(1);
    const empty: VoiceMetrics = { durationSec, speakingSec: 0, pauses: 0, longestPauseSec: 0, pauseRatio: 0, pitchMedianHz: null, pitchSdSemitones: null, pitchRangeSemitones: null, monotone: null, loudnessSdDb: null, voicedFrames: 0 };
    if (this.frames.length < 10) return empty;
    const act = this.activity();
    const first = act.indexOf(true);
    const last = act.lastIndexOf(true);
    if (first < 0) return empty;

    let speaking = 0;
    let pauses = 0;
    let longest = 0;
    let run = 0;
    for (let i = first; i <= last; i++) {
      if (act[i]) {
        speaking++;
        if (run * hop >= 0.6) {
          pauses++;
          longest = Math.max(longest, run * hop);
        }
        run = 0;
      } else run++;
    }
    const span = (last - first + 1) * hop;

    const f0s = this.frames.filter((f, i) => act[i] && f.f0 !== null).map((f) => f.f0!);
    // Drop octave errors and stray detections: keep pitches within an octave of the median.
    const sorted = [...f0s].sort((a, b) => a - b);
    const med = percentile(sorted, 0.5);
    const clean = sorted.filter((f) => f > med / 2 && f < med * 2);
    let sd: number | null = null;
    let range: number | null = null;
    if (clean.length >= 15) {
      const st = clean.map((f) => 12 * Math.log2(f / med));
      const mean = st.reduce((a, b) => a + b, 0) / st.length;
      sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
      range = 12 * Math.log2(percentile(clean, 0.9) / percentile(clean, 0.1));
    }
    const voicedLevels = this.frames.filter((f, i) => act[i] && f.f0 !== null).map((f) => f.level);
    let loud: number | null = null;
    if (voicedLevels.length >= 15) {
      const m = voicedLevels.reduce((a, b) => a + b, 0) / voicedLevels.length;
      loud = Math.sqrt(voicedLevels.reduce((a, b) => a + (b - m) ** 2, 0) / voicedLevels.length);
    }
    return {
      durationSec,
      speakingSec: +(speaking * hop).toFixed(1),
      pauses,
      longestPauseSec: +longest.toFixed(1),
      pauseRatio: +(1 - (speaking * hop) / span).toFixed(2),
      pitchMedianHz: clean.length ? Math.round(med) : null,
      pitchSdSemitones: sd === null ? null : +sd.toFixed(2),
      pitchRangeSemitones: range === null ? null : +range.toFixed(1),
      monotone: sd === null ? null : sd < 1.6,
      loudnessSdDb: loud === null ? null : +loud.toFixed(1),
      voicedFrames: clean.length,
    };
  }
}
