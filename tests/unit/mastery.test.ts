import { describe, expect, it } from "vitest";
import { estimateMastery, practicePlan, topicOf } from "@/lib/interview/mastery";
import { firstQuestion, pickNext } from "@/lib/interview/planner";
import { TECHNICAL } from "@/lib/interview/bank";
import type { InterviewConfig } from "@/lib/interview/types";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 14);
const be = TECHNICAL.backend;

describe("mastery model", () => {
  it("maps follow-up questions to their parent's topic", () => {
    expect(topicOf(`${be[0].id}:probe`)?.topic).toBe(be[0].topic);
  });

  it("separates strong, weak and uncertain topics", () => {
    const ev = [
      ...[88, 92, 85, 90].map((score, i) => ({ questionId: be[0].id, score, at: now - (i + 1) * DAY })),
      ...[30, 25, 40].map((score, i) => ({ questionId: be[1].id, score, at: now - (i + 1) * DAY })),
      { questionId: be[2].id, score: 95, at: now - DAY },
    ];
    const m = estimateMastery(ev, now);
    const by = Object.fromEntries(m.map((t) => [t.topic, t]));
    expect(by[be[0].topic].status).toBe("strong");
    expect(by[be[1].topic].status).toBe("weak");
    // One great answer is promising but not proof: the band stays wide.
    expect(by[be[2].topic].status).toBe("developing");
    expect(by[be[2].topic].high - by[be[2].topic].low).toBeGreaterThan(by[be[0].topic].high - by[be[0].topic].low);
    expect(m[0].topic).toBe(be[1].topic); // weakest first
  });

  it("lets old evidence fade, so a topic last practised long ago is less certain", () => {
    const fresh = estimateMastery([1, 2, 3].map((d) => ({ questionId: be[0].id, score: 90, at: now - d * DAY })), now)[0];
    const stale = estimateMastery([1, 2, 3].map((d) => ({ questionId: be[0].id, score: 90, at: now - (180 + d) * DAY })), now)[0];
    expect(stale.mean).toBeLessThan(fresh.mean);
    expect(stale.high - stale.low).toBeGreaterThan(fresh.high - fresh.low);
  });

  it("schedules reviews: weak topics are due after a day, strong ones after ten", () => {
    const weak = estimateMastery([{ questionId: be[1].id, score: 20, at: now - 2 * DAY }, { questionId: be[1].id, score: 25, at: now - 2 * DAY }, { questionId: be[1].id, score: 30, at: now - 2 * DAY }], now)[0];
    expect(weak.due).toBe(true);
    const strong = estimateMastery([85, 90, 92, 88, 95].map((score) => ({ questionId: be[0].id, score, at: now - 2 * DAY })), now)[0];
    expect(strong.status).toBe("strong");
    expect(strong.due).toBe(false);
  });

  it("plans practice around weak and uncertain topics for the right role", () => {
    const m = estimateMastery(
      [
        { questionId: be[1].id, score: 30, at: now - DAY },
        { questionId: be[2].id, score: 60, at: now - DAY },
        ...[90, 92, 88, 94].map((score) => ({ questionId: be[0].id, score, at: now - DAY })),
        { questionId: TECHNICAL.frontend[0].id, score: 10, at: now - DAY },
      ],
      now,
    );
    const plan = practicePlan(m, { role: "backend" });
    expect(plan.map((p) => p.topic)).toEqual([be[1].topic, be[2].topic]);
  });
});

describe("targeted sessions", () => {
  const cfg: InterviewConfig = { role: "backend", level: "mid", focus: "mixed", totalQuestions: 4, targets: [be[1].topic, be[3].topic] };

  it("skips the warm-up and asks about the target topics first", () => {
    const q1 = firstQuestion(cfg, "seed-1");
    expect(cfg.targets).toContain(q1.topic);
    const fake = (q: typeof q1) => ({ question: q, answer: "x", evaluation: { score: 70, breakdown: { content: 70, depth: 70, structure: 70, delivery: 70 }, covered: [], missing: [], strengths: [], improvements: [], metrics: { words: 50, wpm: null, fillerCount: 0, fillerRate: 0, fillers: {}, avgSentenceWords: 12, hedges: 0, hasNumbers: false, hasExample: false, star: { situation: false, task: false, action: false, result: false } }, source: "rules" as const } });
    const q2 = pickNext(cfg, [fake(q1)], "seed-1")!;
    expect(cfg.targets).toContain(q2.topic);
    expect(q2.topic).not.toBe(q1.topic);
    // Once the targets are used up, the interview carries on with the rest of the bank.
    const q3 = pickNext(cfg, [fake(q1), fake(q2)], "seed-1")!;
    expect(q3).not.toBeNull();
  });
});
