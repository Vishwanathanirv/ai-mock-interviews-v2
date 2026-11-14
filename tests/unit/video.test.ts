import { describe, expect, it } from "vitest";
import { lookingAtCamera, summarizeVideo, videoTips, type FaceSample, type VideoFrame } from "@/lib/video/analysis";

const face = (o: Partial<FaceSample> = {}): FaceSample => ({ yaw: 0, pitch: 0, gaze: 0.1, cx: 0.5, cy: 0.45, w: 0.25, area: 0.1, happy: 0.1, expression: "neutral", ...o });
const frames = (n: number, fn: (i: number, t: number) => FaceSample | null, fps = 6, brightness = 0.5): VideoFrame[] => Array.from({ length: n }, (_, i) => ({ t: i / fps, face: fn(i, i / fps), brightness }));

describe("video analysis", () => {
  it("treats a turned head or turned eyes as not looking at the camera", () => {
    expect(lookingAtCamera(face())).toBe(true);
    expect(lookingAtCamera(face({ yaw: 0.6 }))).toBe(false);
    expect(lookingAtCamera(face({ pitch: -0.5 }))).toBe(false);
    expect(lookingAtCamera(face({ gaze: 0.7 }))).toBe(false);
  });

  it("measures eye contact and counts look-aways of a second or more", () => {
    // 12 s at 6 fps: looks away 2-4 s (2 s) and 7-7.5 s (too short to count) and 9-10.5 s.
    const m = summarizeVideo(frames(72, (_, t) => face({ yaw: (t >= 2 && t < 4) || (t >= 7 && t < 7.5) || (t >= 9 && t < 10.5) ? 0.7 : 0.05 })))!;
    expect(m.lookAways).toBe(2);
    expect(m.eyeContactPct).toBeGreaterThan(60);
    expect(m.eyeContactPct).toBeLessThan(70);
    expect(m.faceVisiblePct).toBe(100);
  });

  it("separates a still head from a fidgeting one", () => {
    const still = summarizeVideo(frames(60, (i) => face({ cx: 0.5 + (i % 2) * 0.002 })))!;
    const fidget = summarizeVideo(frames(60, (_, t) => face({ cx: 0.5 + Math.sin(t * 6) * 0.06, cy: 0.45 + Math.cos(t * 5) * 0.04 })))!;
    expect(still.movement).toBeLessThan(0.15);
    expect(fidget.movement).toBeGreaterThan(0.35);
    expect(videoTips(fidget).improvements.join(" ")).toMatch(/moved around/);
  });

  it("checks framing, lighting and visibility", () => {
    expect(summarizeVideo(frames(30, () => face({ area: 0.01, w: 0.08 })))!.framing).toBe("too far");
    expect(summarizeVideo(frames(30, () => face({ cx: 0.9 })))!.framing).toBe("off-centre");
    expect(summarizeVideo(frames(30, () => face(), 6, 0.1))!.lighting).toBe("dark");
    const gone = summarizeVideo(frames(30, (i) => (i < 20 ? null : face())))!;
    expect(gone.faceVisiblePct).toBe(33);
    expect(videoTips(gone).improvements[0]).toMatch(/in view only 33%/);
  });

  it("praises good eye contact and smiling", () => {
    const m = summarizeVideo(frames(60, (i) => face({ happy: i % 3 === 0 ? 0.8 : 0.1, expression: i % 3 === 0 ? "happy" : "neutral" })))!;
    expect(m.smilePct).toBe(33);
    const tips = videoTips(m);
    expect(tips.strengths.join(" ")).toMatch(/Strong eye contact/);
    expect(tips.strengths.join(" ")).toMatch(/smiled/);
  });

  it("needs a few frames before it says anything", () => {
    expect(summarizeVideo(frames(3, () => face()))).toBeNull();
  });
});
