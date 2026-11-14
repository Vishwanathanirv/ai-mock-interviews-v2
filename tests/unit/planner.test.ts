import { describe, expect, it } from "vitest";
import { buildReport, firstQuestion, pickNext, targetDifficulty } from "@/lib/interview/planner";
import { scoreAnswer } from "@/lib/interview/analyzer";
import type { HistoryItem, InterviewConfig } from "@/lib/interview/types";

const cfg: InterviewConfig = { role: "backend", level: "junior", focus: "mixed", totalQuestions: 5 };

function run(answers: (q: string) => string): HistoryItem[] {
  const history: HistoryItem[] = [];
  let q = firstQuestion(cfg, "seed");
  while (q) {
    const answer = answers(q.text);
    history.push({ question: q, answer, evaluation: scoreAnswer(q, answer, 40) });
    q = pickNext(cfg, history, "seed")!;
  }
  return history;
}

describe("planner", () => {
  it("asks exactly the configured number of questions without repeats", () => {
    const h = run(() => "A reasonable answer with some detail about the system, for example in my project I built it.");
    expect(h).toHaveLength(5);
    const ids = h.filter((x) => !x.question.isFollowUp).map((x) => x.question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("probes a weak answer with a follow-up on a missing concept", () => {
    const h = run(() => "I am not sure, maybe I would look into it somehow and see what happens there.");
    expect(h.some((x) => x.question.isFollowUp)).toBe(true);
    const fu = h.find((x) => x.question.isFollowUp)!;
    expect(fu.question.text).not.toContain("{concept}");
  });

  it("alternates technical and behavioural questions in mixed mode", () => {
    const h = run(() => "First I would measure, then index, then cache. For example in my project latency fell 50%. As a result it worked.").filter((x) => !x.question.isFollowUp);
    expect(h[0].question.kind).toBe("behavioral");
    expect(h[1].question.kind).toBe("technical");
  });

  it("raises difficulty after strong answers", () => {
    const strong = { evaluation: { score: 90 } } as HistoryItem;
    expect(targetDifficulty(cfg, [strong, strong])).toBeGreaterThan(targetDifficulty(cfg, []));
  });

  it("is reproducible for the same seed", () => {
    const a = run(() => "fine answer with detail for example in my project");
    const b = run(() => "fine answer with detail for example in my project");
    expect(a.map((x) => x.question.id)).toEqual(b.map((x) => x.question.id));
  });

  it("builds a report with a verdict and study topics", () => {
    const r = buildReport(cfg, run(() => "short answer"), "rules");
    expect(r.verdict).toBe("Needs practice");
    expect(r.studyTopics.length).toBeGreaterThan(0);
    expect(r.overall).toBeGreaterThanOrEqual(0);
  });
});
