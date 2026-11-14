/**
 * Turn-taking for a hands-free interview: decides, several times a second, whether the candidate
 * is still answering, has finished, wants the question again, or has gone quiet before starting.
 * Pure, so it can be tested without a microphone.
 */

export type TurnInput = {
  /** Live transcript so far (final plus interim words). */
  transcript: string;
  /** Milliseconds since the last sound or new word. */
  quietMs: number;
  /** Milliseconds since the microphone opened. */
  sinceStartMs: number;
  /** Whether the candidate has already been nudged once in this turn. */
  nudged: boolean;
};

export type TurnDecision = "continue" | "end" | "repeat" | "nudge" | "give-up";

const REPEAT = /^(sorry[, ]*)?((can|could|would) you (please )?(repeat|say) (that|it|the question)( again)?|(come again|pardon|what was the question|repeat the question)(,? please)?)\W*$/i;
const WRAP_UP = /\b(that'?s (it|all)|that'?s my answer|i'?m done|that would be (it|all)|yeah,? that'?s it)\W*$/i;

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function decideTurn({ transcript, quietMs, sinceStartMs, nudged }: TurnInput): TurnDecision {
  const words = wordCount(transcript);
  const text = transcript.trim();
  if (words > 0 && words <= 10 && REPEAT.test(text) && quietMs >= 1000) return "repeat";
  if (words >= 2 && WRAP_UP.test(text) && quietMs >= 700) return "end";
  // Short answers get more patience: the candidate may be gathering their thoughts.
  const patience = words < 12 ? 3000 : words < 40 ? 2400 : 2000;
  if (words >= 3 && quietMs >= patience) return "end";
  if (words === 0 && !nudged && sinceStartMs >= 20_000) return "nudge";
  if (words === 0 && nudged && sinceStartMs >= 50_000) return "give-up";
  return "continue";
}
