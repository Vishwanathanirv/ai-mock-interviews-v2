import { describe, expect, it } from "vitest";
import { analyzeDelivery, conceptHit, normalize, scoreAnswer } from "@/lib/interview/analyzer";
import { toAsked } from "@/lib/interview/planner";
import { TECHNICAL, BEHAVIORAL } from "@/lib/interview/bank";

const idemQ = toAsked(TECHNICAL.backend.find((q) => q.id === "be-idem")!);
const conflictQ = toAsked(BEHAVIORAL.find((q) => q.id === "bh-conflict")!);

describe("delivery analysis", () => {
  it("counts filler words but not 'like' used as a verb", () => {
    const m = analyzeDelivery("Um, I like React. It is, like, basically fast, you know.", 10);
    expect(m.fillers.um).toBe(1);
    expect(m.fillers.like).toBe(1);
    expect(m.fillers.basically).toBe(1);
    expect(m.fillers["you know"]).toBe(1);
  });

  it("computes words per minute only for answers long enough to time", () => {
    expect(analyzeDelivery("one two three four five six", 3).wpm).toBeNull();
    expect(analyzeDelivery(Array(150).fill("word").join(" "), 60).wpm).toBe(150);
  });

  it("detects STAR parts", () => {
    const m = analyzeDelivery("When I was at my internship, my task was to fix checkout. I built a retry queue. As a result errors fell 40%.", 30);
    expect(m.star).toEqual({ situation: true, task: true, action: true, result: true });
    expect(m.hasNumbers).toBe(true);
  });
});

describe("concept matching", () => {
  it("matches synonyms and word stems, not substrings of other words", () => {
    expect(conceptHit(normalize("We use an idempotency key"), ["idempotent", "idempotency"])).toBe(true);
    expect(conceptHit(normalize("I prioritised by impact"), ["prioriti"])).toBe(true);
    expect(conceptHit(normalize("the catalog page"), ["cat"])).toBe(false);
  });
});

describe("scoring", () => {
  it("rewards a complete answer over a vague one", () => {
    const strong = scoreAnswer(
      idemQ,
      "First, I verify the webhook signature with an HMAC so only the provider can call it. Then I make the handler idempotent: every event has an event id, and I store it with a unique constraint so a duplicate delivery is ignored. I return 200 quickly so the provider does not retry, and do slow work in a background job. For example, in my payment project this stopped double orders completely.",
      45,
    );
    const weak = scoreAnswer(idemQ, "I would just handle it carefully, maybe check things.", 8);
    expect(strong.score).toBeGreaterThan(70);
    expect(weak.score).toBeLessThan(40);
    expect(strong.missing).toHaveLength(0);
    expect(weak.improvements.length).toBeGreaterThan(0);
  });

  it("asks for missing STAR parts on behavioural answers", () => {
    const e = scoreAnswer(conflictQ, "We disagreed about the database. I listened to his perspective.", 15);
    expect(e.improvements.join(" ")).toMatch(/STAR/);
  });

  it("keeps every score within 0-100", () => {
    const e = scoreAnswer(idemQ, "um ".repeat(400), 20);
    for (const v of [e.score, ...Object.values(e.breakdown)]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
