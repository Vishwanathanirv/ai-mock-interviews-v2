/**
 * The end of a real interview: "Do you have any questions for me?". Without AI, the interviewer
 * still answers the common questions sensibly, and the candidate gets honest feedback on how
 * their question (or the lack of one) lands.
 */

const NONE = /^\W*(no|nope|nah|nothing|not really|i don'?t( have any)?|i'?m good|that'?s (all|it)|no questions?|i think (that'?s|i'?m) (all|good))\b/i;
const MONEY = /\b(salary|pay|package|ctc|stipend|compensation|leave|leaves|holidays?|vacation|time off|work from home|wfh|bonus)\b/i;

const ANSWERS: { re: RegExp; reply: string }[] = [
  { re: /\b(day|typical|daily|week)\b/i, reply: "A typical week is a mix of building, code review and a couple of planning conversations. We try to protect long stretches for focused work." },
  { re: /\b(team|people|culture|work with)\b/i, reply: "It's a small team of six or seven. People are friendly and direct, and we review each other's work a lot." },
  { re: /\b(learn|growth|grow|mentor|training|career)\b/i, reply: "New people get a mentor for the first few months, and we expect you to own something real within your first quarter." },
  { re: /\b(success|measure|expect|first (90|ninety) days|first (three|3) months|goals?)\b/i, reply: "In the first three months, success means you've shipped something end to end and the team trusts your reviews." },
  { re: /\b(challenge|hardest|problem|difficult)\b/i, reply: "Honestly, our biggest challenge right now is moving fast without breaking things as we grow." },
  { re: /\b(next steps?|process|hear back|timeline|when will)\b/i, reply: "We'll get back to you within a week, and if it's a yes, the next round is a longer technical conversation with the team." },
  { re: /\b(tech|stack|tools|technolog)\b/i, reply: "We use fairly standard, boring technology on purpose, so most of the interesting work is in the problems, not the tools." },
];

export function closingRules(question: string): { reply: string; note: string; asked: boolean } {
  const q = question.trim();
  const words = q ? q.split(/\s+/).length : 0;
  if (!q || NONE.test(q) || words < 3) {
    return {
      asked: false,
      reply: "That's fine. Thanks again for your time today, it was good talking to you.",
      note: "You didn't ask anything. In a real interview that can read as low interest. Prepare two questions about the work, the team, or how success is measured in the first few months.",
    };
  }
  const known = ANSWERS.find((a) => a.re.test(q));
  const reply = `${known ? `Good question. ${known.reply}` : "Good question. Honestly, it depends a bit on the team, but I'm happy to follow up on that by email."} Thanks again for your time today.`;
  if (MONEY.test(q) && !known) {
    return {
      asked: true,
      reply: "That's something our recruiter will go through with you in detail. Thanks again for your time today.",
      note: "You asked about pay or time off first. That's a fair thing to want to know, but leading with it in an early round can come across as more interested in the perks than the work. Save it for the recruiter or a later round.",
    };
  }
  return {
    asked: true,
    reply,
    note: known
      ? "Good: you asked a real question about the role. Interviewers notice that, and it ends the conversation on your terms."
      : "You asked a question, which is good. Make it sharper next time by tying it to the work itself, for example what success looks like in the first three months.",
  };
}
