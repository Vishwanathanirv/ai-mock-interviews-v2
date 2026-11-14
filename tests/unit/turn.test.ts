import { describe, expect, it } from "vitest";
import { decideTurn } from "@/lib/voice/turn";

const t = (transcript: string, quietMs: number, sinceStartMs = 10_000, nudged = false) => decideTurn({ transcript, quietMs, sinceStartMs, nudged });

describe("hands-free turn-taking", () => {
  it("keeps listening through the short pauses of normal speech", () => {
    expect(t("So in my last project I built", 600)).toBe("continue");
    expect(t("So in my last project I built a payment service and", 1800)).toBe("continue");
  });

  it("ends the turn after a real silence, with more patience for short answers", () => {
    const long = "In my last project I built a payment service that handled webhooks from the provider, and the main problem was duplicate events, so I made the handler idempotent with a unique key and stored the event id before doing any work";
    expect(t(long, 2100)).toBe("end");
    expect(t("I used a unique key", 2100)).toBe("continue");
    expect(t("I used a unique key", 3100)).toBe("end");
  });

  it("ends quickly when the candidate signals they are done", () => {
    expect(t("I would cache it at the edge. That's it.", 800)).toBe("end");
    expect(t("I would cache it at the edge, that's all", 800)).toBe("end");
  });

  it("repeats the question when asked, instead of grading the request", () => {
    expect(t("Sorry, can you repeat the question?", 1100)).toBe("repeat");
    expect(t("Could you say that again", 1100)).toBe("repeat");
    expect(t("pardon", 1100)).toBe("repeat");
    expect(t("I would repeat the question back to the client to make sure", 2500)).not.toBe("repeat");
  });

  it("nudges once after a long silence, then moves on", () => {
    expect(t("", 20_000, 20_500)).toBe("nudge");
    expect(t("", 30_000, 30_000, true)).toBe("continue");
    expect(t("", 50_000, 50_500, true)).toBe("give-up");
  });

  it("never ends a turn that has not started", () => {
    expect(t("", 5_000, 5_000)).toBe("continue");
    expect(t("Um", 4_000)).toBe("continue");
  });

  it("waits much longer when the candidate asks for a moment", () => {
    expect(t("Good question, let me think.", 4_000)).toBe("continue");
    expect(t("Hmm, give me a second", 8_000)).toBe("continue");
    expect(t("Good question, let me think.", 9_500)).toBe("end");
  });

  it("cuts in politely when an answer runs past three minutes", () => {
    expect(t("and then we also did a lot of other things with the system", 100, 181_000)).toBe("cut-in");
    expect(t("and then we also did a lot of other things with the system", 100, 170_000)).toBe("continue");
  });
});
