/**
 * On-camera presence, measured from face tracking that runs in the browser. Frames never leave
 * the device: only the summary below is sent with the answer.
 *
 * Per frame we get the head's yaw and pitch, how far the eyes are turned (gaze strength), where
 * the face sits in the picture, the expression scores, and the picture's brightness. From those:
 * eye contact (head facing the camera and eyes not turned away), look-aways, smiling, how much
 * the head moves around, framing and lighting.
 */

export type FaceSample = {
  /** Radians; 0 is facing the camera. */
  yaw: number;
  pitch: number;
  /** Head tilt towards a shoulder, in radians. Large values mean lying down or slumped sideways. */
  roll?: number;
  /** 0 = eyes centred, 1 = turned fully to one side. */
  gaze: number;
  /** Face centre, as a fraction of frame width/height. */
  cx: number;
  cy: number;
  /** Face width and area as fractions of the frame. */
  w: number;
  area: number;
  /** Expression probabilities (0 to 1). */
  happy: number;
  expression: string;
};

export type VideoFrame = { t: number; face: FaceSample | null; brightness: number };

export type VideoMetrics = {
  durationSec: number;
  frames: number;
  faceVisiblePct: number;
  eyeContactPct: number;
  /** Times the candidate looked away for a second or more. */
  lookAways: number;
  smilePct: number;
  /** Average head movement, in face-widths per second. Under ~0.15 is calm. */
  movement: number;
  framing: "good" | "too far" | "too close" | "off-centre";
  lighting: "good" | "dark" | "too bright";
  expression: string | null;
  /** Share of tracked frames with the head tilted far to one side (lying down). */
  tiltedPct?: number;
};

/** Head tilted more than about 32° towards a shoulder: lying down, or slumped sideways. */
export const tilted = (f: FaceSample) => Math.abs(f.roll ?? 0) > 0.55;

/** A problem the interviewer would notice right now: lying down, out of frame, or looking away. */
export type LiveIssue = "tilted" | "gone" | "away";
export type IssueClock = Record<LiveIssue, number | null>;
/** How long each problem must last before it counts, in seconds. */
export const ISSUE_AFTER: Record<LiveIssue, number> = { tilted: 2, gone: 3, away: 5 };

/**
 * Feeds one camera frame into the running clocks and returns the problem that has lasted long
 * enough to mention, most serious first. Brief glances away or a quick stretch never count.
 */
export function liveIssue(clock: IssueClock, face: FaceSample | null, t: number): LiveIssue | null {
  const state: Record<LiveIssue, boolean> = { gone: face === null, tilted: face !== null && tilted(face), away: face !== null && !lookingAtCamera(face) };
  let issue: LiveIssue | null = null;
  for (const k of ["tilted", "gone", "away"] as LiveIssue[]) {
    if (!state[k]) clock[k] = null;
    else if (clock[k] === null) clock[k] = t;
    else if (!issue && t - clock[k]! >= ISSUE_AFTER[k]) issue = k;
  }
  return issue;
}

/**
 * Things a real interviewer would stop and mention, seen on camera: not sitting upright, or
 * not being on camera at all. They count as red flags like their spoken equivalents.
 */
export function videoFlags(m: VideoMetrics | undefined): { flags: string[]; advice: string[] } {
  const flags: string[] = [];
  const advice: string[] = [];
  if (!m || m.frames < 10) return { flags, advice };
  if (m.faceVisiblePct >= 40 && (m.tiltedPct ?? 0) >= 40) {
    flags.push("not sitting upright");
    advice.push("On camera you were lying down or tilted to one side for most of the answer. Sit upright at a desk, facing the camera. A real interviewer notices that before you say a word.");
  }
  if (m.faceVisiblePct < 25) {
    flags.push("out of the camera view");
    advice.push(`You were out of the camera's view for most of the answer (visible ${m.faceVisiblePct}% of the time). Stay centred in the frame the whole time.`);
  }
  return { flags, advice };
}

/** Head within about 20° of the camera, and eyes not turned away. */
export const lookingAtCamera = (f: FaceSample) => Math.abs(f.yaw) < 0.35 && Math.abs(f.pitch) < 0.3 && f.gaze < 0.45;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function summarizeVideo(frames: VideoFrame[]): VideoMetrics | null {
  if (frames.length < 5) return null;
  const durationSec = +(frames[frames.length - 1].t - frames[0].t).toFixed(1);
  const faces = frames.filter((f) => f.face);
  const withFace = faces.map((f) => f.face!);
  const contact = withFace.filter(lookingAtCamera).length;

  // Look-aways: runs of at least one second with the face visible but not looking at the camera.
  let lookAways = 0;
  let awaySince: number | null = null;
  let counted = false;
  for (const f of frames) {
    const away = f.face !== null && !lookingAtCamera(f.face);
    if (away) {
      if (awaySince === null) {
        awaySince = f.t;
        counted = false;
      }
      if (!counted && f.t - awaySince >= 1) {
        lookAways++;
        counted = true;
      }
    } else awaySince = null;
  }

  // Movement: face-centre travel between consecutive tracked frames, in face widths per second.
  let travel = 0;
  let time = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].face;
    const b = frames[i].face;
    const dt = frames[i].t - frames[i - 1].t;
    if (!a || !b || dt <= 0 || dt > 1.5) continue;
    const width = Math.max(0.02, (a.w + b.w) / 2);
    travel += Math.hypot(b.cx - a.cx, b.cy - a.cy) / width;
    time += dt;
  }

  const area = median(withFace.map((f) => f.area));
  const cx = median(withFace.map((f) => f.cx));
  const cy = median(withFace.map((f) => f.cy));
  const framing: VideoMetrics["framing"] = !withFace.length ? "off-centre" : area < 0.03 ? "too far" : area > 0.4 ? "too close" : Math.abs(cx - 0.5) > 0.25 || Math.abs(cy - 0.45) > 0.3 ? "off-centre" : "good";
  const light = median(frames.map((f) => f.brightness));
  const lighting: VideoMetrics["lighting"] = light < 0.22 ? "dark" : light > 0.88 ? "too bright" : "good";

  const counts = new Map<string, number>();
  for (const f of withFace) counts.set(f.expression, (counts.get(f.expression) ?? 0) + 1);
  const expression = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    durationSec,
    frames: frames.length,
    faceVisiblePct: pct(faces.length, frames.length),
    eyeContactPct: pct(contact, withFace.length),
    lookAways,
    smilePct: pct(withFace.filter((f) => f.happy > 0.5).length, withFace.length),
    movement: time ? +(travel / time).toFixed(2) : 0,
    framing,
    lighting,
    expression,
    tiltedPct: pct(withFace.filter(tilted).length, withFace.length),
  };
}

/** Plain-English coaching from the numbers, most important first. */
export function videoTips(m: VideoMetrics): { strengths: string[]; improvements: string[] } {
  const strengths: string[] = [];
  const improvements: string[] = [];
  if (m.faceVisiblePct < 60) improvements.push(`Your face was in view only ${m.faceVisiblePct}% of the time. Sit centred, about an arm's length from the camera.`);
  else if (m.eyeContactPct < 55) improvements.push(`You looked at the camera ${m.eyeContactPct}% of the time${m.lookAways ? ` and looked away ${m.lookAways} time${m.lookAways === 1 ? "" : "s"}` : ""}. Look at the lens, not the screen, when you make your main point.`);
  else if (m.eyeContactPct >= 70) strengths.push(`Strong eye contact: you looked at the camera ${m.eyeContactPct}% of the time.`);
  if (m.movement > 0.35) improvements.push("Your head moved around a lot. Settle your posture; stillness reads as confidence on camera.");
  if (m.lighting === "dark") improvements.push("You're hard to see: face a window or put a lamp behind the screen.");
  if (m.lighting === "too bright") improvements.push("The picture is washed out: move away from direct light behind or above you.");
  if (m.framing === "too far") improvements.push("You're far from the camera; move closer so your head and shoulders fill the frame.");
  if (m.framing === "too close") improvements.push("You're very close to the camera; sit back a little.");
  if (m.framing === "off-centre") improvements.push("Centre yourself in the frame.");
  if (m.smilePct >= 15) strengths.push("A friendly expression: you smiled naturally while answering.");
  else if (m.faceVisiblePct >= 60 && m.smilePct < 3) improvements.push("Try a natural smile when you introduce a story; it makes you more engaging on video.");
  return { strengths, improvements };
}
