import { describe, expect, it } from "vitest";
import { BEHAVIORAL, TECHNICAL } from "@/lib/interview/bank";
import { closingRules } from "@/lib/interview/closing";
import { HIRE_BAR, hiringDecision } from "@/lib/interview/planner";
import { rulesReaction, scoreAnswer } from "@/lib/interview/analyzer";
import { toAsked } from "@/lib/interview/planner";
import { ROLES, ROLE_LABELS, ROLE_TEAMS, type HistoryItem, type InterviewConfig } from "@/lib/interview/types";

const cfg: InterviewConfig = { role: "backend", level: "junior", focus: "mixed", totalQuestions: 3 };
const q = toAsked(TECHNICAL.backend[0]);
const item = (answer: string, score?: number): HistoryItem => {
  const evaluation = scoreAnswer(q, answer, 30);
  return { question: q, answer, evaluation: score === undefined ? evaluation : { ...evaluation, score } };
};
const breakdown = { content: 70, depth: 60, structure: 70, delivery: 70 };

describe("question bank", () => {
  it("has a full, well-formed set for every role", () => {
    const ids = new Set<string>();
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_TEAMS[role]).toMatch(/^the /);
      expect(TECHNICAL[role].length).toBeGreaterThanOrEqual(6);
      for (const b of [...TECHNICAL[role]]) {
        expect(ids.has(b.id)).toBe(false);
        ids.add(b.id);
        expect(b.concepts.length).toBeGreaterThanOrEqual(3);
        expect(b.probe).toContain("{concept}");
        expect(new Set(TECHNICAL[role].map((x) => x.difficulty)).size).toBeGreaterThan(1);
      }
    }
    expect(BEHAVIORAL.length).toBeGreaterThanOrEqual(10);
  });

  it("recognises a good answer in a new track", () => {
    const sub = toAsked(TECHNICAL.network.find((b) => b.id === "nw-subnet")!);
    const e = scoreAnswer(sub, "Borrow two bits so the mask becomes /26, 255.255.255.192. The subnets start at .0, .64, .128 and .192, each with 62 usable hosts because the network address and broadcast address are reserved.", 40);
    expect(e.missing).toEqual([]);
  });
});

describe("the interviewer stays in character", () => {
  it("never states a score or what was missing out loud", () => {
    for (const [answer, score] of [["I would use caching and an index and measure it again with explain.", 85], ["Not really sure, maybe some caching or something like that I guess.", 30]] as const) {
      const line = rulesReaction(q, { ...item(answer).evaluation, score }, answer);
      expect(line).not.toMatch(/\d|score|missed|didn't answer|wrong/i);
    }
  });

  it("addresses conduct on the spot", () => {
    const answer = "I'm lying in bed right now but I'd add an index.";
    expect(rulesReaction(q, item(answer).evaluation, answer)).toMatch(/quiet/);
  });
});

describe("hiring decision", () => {
  it("measures against the bar for the level", () => {
    const h = [item("x", 80), item("x", 80)];
    expect(hiringDecision(cfg, h, HIRE_BAR.junior + 16, breakdown).call).toBe("Strong hire");
    expect(hiringDecision(cfg, h, HIRE_BAR.junior + 1, breakdown).call).toBe("Lean hire");
    expect(hiringDecision({ ...cfg, level: "senior" }, h, HIRE_BAR.junior + 1, breakdown).nextRound).toBe(false);
  });

  it("caps the call for conduct problems, whatever the score", () => {
    const h = [item("I'm lying in bed lol, but I'd add an index on the column and check the plan."), item("x", 95)];
    const d = hiringDecision(cfg, h, 90, breakdown);
    expect(d.call).toBe("Lean no hire");
    expect(d.nextRound).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/unprofessional setting/);
  });

  it("caps the call when questions are skipped", () => {
    const d = hiringDecision(cfg, [item("I don't know"), item("Pass"), item("x", 95)], 80, breakdown);
    expect(d.nextRound).toBe(false);
  });
});

describe("closing questions", () => {
  it("answers a real question and says so", () => {
    const c = closingRules("What does a typical week look like on your team?");
    expect(c.asked).toBe(true);
    expect(c.reply).toMatch(/typical week/i);
  });

  it("treats no question as a missed chance", () => {
    for (const none of ["No, I'm good.", "Nope", "", "no questions"]) {
      const c = closingRules(none);
      expect(c.asked).toBe(false);
      expect(c.note).toMatch(/low interest/);
    }
  });

  it("flags leading with pay", () => {
    expect(closingRules("How much is the salary for this role?").note).toMatch(/pay or time off/);
  });
});

import { liveIssue, summarizeVideo, videoFlags, type FaceSample, type IssueClock, type VideoFrame } from "@/lib/video/analysis";

const face = (o: Partial<FaceSample> = {}): FaceSample => ({ yaw: 0, pitch: 0, roll: 0, gaze: 0.1, cx: 0.5, cy: 0.45, w: 0.25, area: 0.1, happy: 0.1, expression: "neutral", ...o });
const frames = (n: number, f: (i: number) => FaceSample | null): VideoFrame[] => Array.from({ length: n }, (_, i) => ({ t: i * 0.2, face: f(i), brightness: 0.5 }));

describe("camera, watched like a real interviewer would", () => {
  it("notices lying down after a couple of seconds, not a quick stretch", () => {
    const clock: IssueClock = { tilted: null, gone: null, away: null };
    const lying = face({ roll: 1.4 });
    expect(liveIssue(clock, lying, 0)).toBeNull();
    expect(liveIssue(clock, lying, 1)).toBeNull();
    expect(liveIssue(clock, face(), 1.2)).toBeNull(); // sat back up: the clock resets
    expect(liveIssue(clock, lying, 1.4)).toBeNull();
    expect(liveIssue(clock, lying, 3.5)).toBe("tilted");
  });

  it("notices leaving the frame and looking away for long stretches", () => {
    const clock: IssueClock = { tilted: null, gone: null, away: null };
    expect(liveIssue(clock, null, 0)).toBeNull();
    expect(liveIssue(clock, null, 3.1)).toBe("gone");
    const c2: IssueClock = { tilted: null, gone: null, away: null };
    expect(liveIssue(c2, face({ yaw: 0.8 }), 0)).toBeNull();
    expect(liveIssue(c2, face({ yaw: 0.8 }), 4)).toBeNull();
    expect(liveIssue(c2, face({ yaw: 0.8 }), 5.2)).toBe("away");
  });

  it("turns lying down on camera into a red flag that caps the score and that he mentions", () => {
    const m = summarizeVideo(frames(40, () => face({ roll: 1.3 })))!;
    expect(m.tiltedPct).toBe(100);
    expect(videoFlags(m).flags).toContain("not sitting upright");
    const e = scoreAnswer(q, "I would add an index on the column used in the where clause and check the plan with explain, then measure the latency again.", 30, undefined, m);
    expect(e.redFlags).toContain("not sitting upright");
    expect(e.score).toBeLessThan(40);
    expect(e.reaction).toMatch(/sit up/i);
  });

  it("does not flag someone sitting normally", () => {
    const m = summarizeVideo(frames(40, () => face()))!;
    expect(videoFlags(m).flags).toEqual([]);
  });
});
