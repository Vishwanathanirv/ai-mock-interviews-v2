import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateWithAI } from "@/lib/interview/gemini";
import { scoreAnswer } from "@/lib/interview/analyzer";
import { toAsked } from "@/lib/interview/planner";
import { TECHNICAL } from "@/lib/interview/bank";

const q = toAsked(TECHNICAL.backend[0]);
const cfg = { role: "backend", level: "junior", focus: "technical", totalQuestions: 5 } as const;
const answer = "Um, I'd use GET and POST, return 201 on create and 404 when missing, and validate with a schema.";

function mockGemini(payload: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: ok ? 200 : 500 }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("gemini evaluation", () => {
  it("uses AI content scores but keeps measured delivery", async () => {
    process.env.GEMINI_API_KEY = "test";
    const rules = scoreAnswer(q, answer, 20);
    const spy = mockGemini({ content: 80, depth: 60, structure: 70, covered: ["verbs"], missing: ["auth"], strengths: ["Good codes."], improvements: ["Mention auth."], followUp: "How would you secure it?" });
    const e = await evaluateWithAI(cfg, q, answer, rules);
    expect(spy).toHaveBeenCalledOnce();
    expect(e.source).toBe("ai");
    expect(e.breakdown).toMatchObject({ content: 80, depth: 60, structure: 70, delivery: rules.breakdown.delivery });
    expect(e.metrics).toEqual(rules.metrics);
    expect(e.followUp).toBe("How would you secure it?");
    const headers = spy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test");
    expect(String(spy.mock.calls[0][0])).not.toContain("key=");
  });

  it("rejects malformed model output so the caller can fall back", async () => {
    process.env.GEMINI_API_KEY = "test";
    mockGemini({ content: "lots" });
    await expect(evaluateWithAI(cfg, q, answer, scoreAnswer(q, answer, 20))).rejects.toThrow();
  });

  it("surfaces HTTP errors", async () => {
    process.env.GEMINI_API_KEY = "test";
    mockGemini({}, false);
    await expect(evaluateWithAI(cfg, q, answer, scoreAnswer(q, answer, 20))).rejects.toThrow(/Gemini 500/);
  });
});
