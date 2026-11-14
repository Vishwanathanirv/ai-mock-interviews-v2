import { afterEach, describe, expect, it, vi } from "vitest";
import { turnWithAI } from "@/lib/interview/gemini";
import { scoreAnswer } from "@/lib/interview/analyzer";
import { buildReport, depthOf, MAX_DEPTH, nextCandidates, pickNext, toAsked } from "@/lib/interview/planner";
import { TECHNICAL } from "@/lib/interview/bank";
import type { HistoryItem, InterviewConfig } from "@/lib/interview/types";

const cfg: InterviewConfig = { role: "backend", level: "junior", focus: "technical", totalQuestions: 6 };
const root = TECHNICAL.backend[0];
const q = toAsked(root);
const answer = "I'd use GET and POST, return 201 on create and 404 when missing, and validate with a schema.";
const item = (question = q, text = answer): HistoryItem => ({ question, answer: text, evaluation: scoreAnswer(question, text, 20) });

function mockGemini(payload: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 }));
}
afterEach(() => vi.restoreAllMocks());

describe("he digs deeper, like a person", () => {
  it("follows up on his own question twice at most, then moves on", () => {
    const first = pickNext(cfg, [item()], "s", { followUp: "Why 201 and not 200?" })!;
    expect(first).toMatchObject({ isFollowUp: true, depth: 1, parentId: root.id, text: "Why 201 and not 200?" });
    expect(depthOf(first.id)).toBe(1);
    const second = pickNext(cfg, [item(), item(first)], "s", { followUp: "And if the client retries?" })!;
    expect(second).toMatchObject({ depth: 2, id: `${root.id}:probe2` });
    const third = pickNext(cfg, [item(), item(first), item(second)], "s", { followUp: "One more?" })!;
    expect(third.isFollowUp).toBe(false);
    expect(MAX_DEPTH).toBe(2);
  });

  it("moves to the topic he picked from the conversation", () => {
    const options = nextCandidates(cfg, [item()], "s");
    expect(options.length).toBeGreaterThan(1);
    const pick = options[options.length - 1];
    expect(pickNext(cfg, [item()], "s", { nextId: pick.id })!.id).toBe(pick.id);
    // An id that isn't a valid next question is ignored.
    expect(pickNext(cfg, [item()], "s", { nextId: "made-up" })).not.toBeNull();
  });
});

describe("the live turn decision", () => {
  it("asks the fast model and returns what he says and does", async () => {
    process.env.GEMINI_API_KEY = "test";
    const spy = mockGemini({ reaction: "Interesting, you went straight to status codes.", action: "follow_up", followUp: "Why 201 and not 200?" });
    const plan = await turnWithAI(cfg, q, answer, item().evaluation, [], nextCandidates(cfg, [item()], "s"), true);
    expect(String(spy.mock.calls[0][0])).toContain("flash-lite");
    const prompt = JSON.parse(spy.mock.calls[0][1]!.body as string).contents[0].parts[0].text as string;
    expect(prompt).toMatch(/What you noticed while they spoke/);
    expect(plan).toEqual({ reaction: "Interesting, you went straight to status codes.", followUp: "Why 201 and not 200?" });
  });

  it("won't dig further when he already has, and only picks real next questions", async () => {
    process.env.GEMINI_API_KEY = "test";
    mockGemini({ reaction: "Okay.", action: "follow_up", followUp: "Again?", nextId: "nope" });
    expect(await turnWithAI(cfg, q, answer, item().evaluation, [], [], false)).toEqual({ reaction: "Okay." });
  });
});

describe("his verdict at the end", () => {
  it("is blunt and points at the weakest answer", () => {
    const weak = item(q, "I don't know, maybe GET.");
    const r = buildReport(cfg, [weak, item()], "rules");
    expect(r.summary).toMatch(/^(I'll be straight with you|As it stands, I wouldn't)/);
    expect(r.summary).toMatch(/Your weakest moment was when I asked/);
    expect(r.summary).toMatch(/The one thing to fix/);
  });
});
