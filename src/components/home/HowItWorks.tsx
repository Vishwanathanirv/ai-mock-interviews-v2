"use client";

import { useMemo, useState } from "react";
import { scoreAnswer, weighted } from "@/lib/interview/analyzer";
import { findQuestion } from "@/lib/interview/bank";
import { shouldProbe, toAsked } from "@/lib/interview/planner";

/**
 * How it works, as one answer walked through the real grader: every number below comes from the
 * same scoring code that runs after each answer in an interview, on the text you choose or type.
 */
const QUESTIONS = [
  {
    id: "be-rest",
    answers: [
      { label: "Strong", text: "First I'd model the resource: GET /todos lists them, POST /todos creates one and returns 201, PATCH /todos/:id updates and DELETE removes it, with 404 when the id doesn't exist. Every body is checked against a schema, so a missing title gets a 400 with a clear message. For example, each request also needs a bearer token, and the API returns 401 without it." },
      { label: "Thin", text: "Um, I'd basically have like a get and a post endpoint for the todos, I think." },
      { label: "Gives up", text: "I don't know, skip." },
    ],
  },
  {
    id: "bh-intro",
    answers: [
      { label: "Strong", text: "I studied computer science and spent the last two years building internal tools. The project I'm proudest of is a deploy dashboard I built that cut release time from 40 minutes to 8. My key strength is turning vague requests into small, shippable steps. I'm applying because this role owns the developer platform, which is exactly the work I want to grow in." },
      { label: "Thin", text: "I'm a developer and I like coding, so I applied." },
      { label: "Too relaxed", text: "Honestly I'm lying in bed right now lol, but yeah I code stuff." },
    ],
  },
] as const;

/** How long an answer takes at a natural speaking pace (about 140 words a minute), to the nearest 5 s. */
const natural = (t: string) => Math.max(5, Math.round((t.split(/\s+/).filter(Boolean).length * 60) / 140 / 5) * 5);

const STAGES = ["Conduct", "Content", "Depth and structure", "Delivery", "Score", "What happens next"] as const;

const bar = (n: number) => (
  <span className="relative inline-block h-2 w-40 rounded-full bg-pen/15 align-middle" aria-hidden>
    <span className="absolute inset-y-0 left-0 rounded-full bg-pen" style={{ width: `${Math.max(2, n)}%` }} />
  </span>
);

export function HowItWorks() {
  const [qi, setQi] = useState(0);
  const [text, setText] = useState<string>(QUESTIONS[0].answers[0].text);
  const [seconds, setSeconds] = useState(() => natural(QUESTIONS[0].answers[0].text));
  const [step, setStep] = useState(0);
  const bank = findQuestion(QUESTIONS[qi].id)!;
  const question = useMemo(() => toAsked(bank), [bank]);
  const e = useMemo(() => scoreAnswer(question, text, seconds), [question, text, seconds]);
  const m = e.metrics;
  const w = question.kind === "technical" ? { content: 45, depth: 25, structure: 15, delivery: 15 } : { content: 30, depth: 20, structure: 30, delivery: 20 };
  const probe = shouldProbe(e) && bank.probe ? bank.probe.replace("{concept}", e.missing[0]) : null;
  const capped = e.redFlags?.some((f) => f === "no real answer" || f === "unprofessional setting" || f === "not sitting upright");

  return (
    <div className="rounded-md border-[1.5px] border-pen/70 bg-paper p-5 sm:p-6">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Question">
        {QUESTIONS.map((q, i) => (
          <button
            key={q.id}
            role="radio"
            aria-checked={qi === i}
            onClick={() => {
              setQi(i);
              setText(q.answers[0].text);
              setSeconds(natural(q.answers[0].text));
            }}
            className={`rounded-full border px-3 py-1 text-sm ${qi === i ? "border-pen bg-pen text-paper" : "border-pen/40 text-muted hover:text-ink"}`}
          >
            {findQuestion(q.id)!.kind === "technical" ? "A technical question" : "A behavioural question"}
          </button>
        ))}
      </div>
      <p className="mt-3 font-display text-lg leading-snug text-pen">&ldquo;{question.text}&rdquo;</p>

      <label htmlFor="how-answer" className="mt-4 block text-sm text-muted">
        Your answer, as the transcript would read
      </label>
      <textarea id="how-answer" rows={4} value={text} onChange={(ev) => setText(ev.target.value)} className="mt-1 w-full resize-y rounded-md border border-pen/40 bg-transparent p-3 leading-snug outline-none focus:border-pen focus:ring-2 focus:ring-pen/30" />
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {QUESTIONS[qi].answers.map((a) => (
          <button key={a.label} type="button" className="text-muted underline decoration-pen/30 underline-offset-4 hover:text-ink" onClick={() => {
              setText(a.text);
              setSeconds(natural(a.text));
            }}>
            {a.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-muted">
          Spoken in
          <input type="range" min={5} max={180} step={5} value={seconds} onChange={(ev) => setSeconds(Number(ev.target.value))} aria-label="How long the answer took, in seconds" className="accent-[var(--pen)]" />
          <span className="w-10 tabular-nums text-ink">{seconds}s</span>
        </label>
      </div>

      <ol className="mt-5 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Stages">
        {STAGES.map((s, i) => (
          <li key={s}>
            <button onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className={`h-full w-full rounded-md border px-2 py-1.5 text-left text-[13px] leading-tight ${step === i ? "border-pen bg-pen/10 text-ink" : "border-pen/30 text-muted hover:text-ink"}`}>
              <span className="block font-mono text-[11px] text-faint">{i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <section className="mt-4 min-h-[13rem] border-l-2 border-pencil pl-4" aria-live="polite">
        {step === 0 && (
          <>
            <p className="leading-relaxed text-muted">Before grading what you said, the grader checks how you said it. A non-answer, an unprofessional setting or a dismissive tone ends a real interview, so it caps every score here, however many keywords slip in.</p>
            {e.redFlags?.length ? <p className="mt-3 font-medium text-pencil">Flagged: {e.redFlags.join(", ")}. Every score below is capped.</p> : <p className="mt-3 text-ink">No red flags. The answer is graded on its merits.</p>}
          </>
        )}
        {step === 1 && (
          <>
            <p className="leading-relaxed text-muted">Each question carries the ideas a good answer covers, with the different ways people say them. Coverage of those ideas is most of the content score.</p>
            <ul className="mt-3 space-y-1">
              {question.concepts.map((c) => {
                const hit = e.covered.includes(c[0]);
                return (
                  <li key={c[0]} className={hit ? "text-ink" : "text-pencil"}>
                    {hit ? "✓" : "✗"} {c[0]}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-sm text-muted">Content {e.breakdown.content}/100</p>
          </>
        )}
        {step === 2 && (
          <>
            <p className="leading-relaxed text-muted">{question.kind === "behavioral" ? "Depth rewards a substantial answer with numbers and a concrete example. Structure looks for situation, task, action and result, plus words that link the steps." : "Depth rewards a substantial answer with numbers and a concrete example. Structure looks for signposting (first, then, because) and sentences short enough to follow out loud."}</p>
            <ul className="mt-3 space-y-1 text-ink">
              <li>{m.words} words{m.hasNumbers ? ", with numbers" : ""}{m.hasExample ? ", with an example" : ""}</li>
              {question.kind === "behavioral" && (
                <li>
                  STAR: {(["situation", "task", "action", "result"] as const).map((k) => `${m.star[k] ? "✓" : "✗"} ${k}`).join("  ")}
                </li>
              )}
              <li>Average sentence: {Math.round(m.avgSentenceWords)} words</li>
            </ul>
            <p className="mt-2 text-sm text-muted">
              Depth {e.breakdown.depth}/100 · Structure {e.breakdown.structure}/100
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <p className="leading-relaxed text-muted">Delivery starts at 100 and loses points for pace outside 100 to 175 words a minute, filler words and hedging. In a spoken interview the microphone also measures pauses and how flat the voice is; this example is text only.</p>
            <ul className="mt-3 space-y-1 text-ink">
              <li>Pace: {m.wpm === null ? "not measured" : `${Math.round(m.wpm)} words a minute`}</li>
              <li>
                Fillers: {m.fillerCount}
                {m.fillerCount > 0 && ` (${Object.keys(m.fillers).join(", ")})`}
              </li>
              <li>Hedges: {m.hedges}</li>
            </ul>
            <p className="mt-2 text-sm text-muted">Delivery {e.breakdown.delivery}/100</p>
          </>
        )}
        {step === 4 && (
          <>
            <p className="leading-relaxed text-muted">The four parts are weighted by the kind of question: what you know matters most in a technical answer, how you tell it matters as much in a behavioural one.{capped ? " This answer's red flags cap each part first." : ""}</p>
            <ul className="mt-3 space-y-1.5 text-ink">
              {(["content", "depth", "structure", "delivery"] as const).map((k) => (
                <li key={k} className="flex flex-wrap items-center gap-3">
                  <span className="w-20 capitalize">{k}</span>
                  {bar(e.breakdown[k])}
                  <span className="tabular-nums text-muted">
                    {e.breakdown[k]} × {w[k]}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-display text-3xl font-semibold text-pen">{weighted(e.breakdown, question.kind)}/100</p>
          </>
        )}
        {step === 5 && (
          <>
            <p className="leading-relaxed text-muted">Arjun reacts in character and keeps the grade for your report. If a key idea is missing and the answer scored under 65, he digs into it with a follow-up instead of moving on.</p>
            <p className="mt-3 font-display text-lg text-pen">&ldquo;{e.reaction}&rdquo;</p>
            {probe ? <p className="mt-2 font-display text-lg text-pen">&ldquo;{probe}&rdquo;</p> : <p className="mt-2 text-sm text-muted">No follow-up: he moves to the next question.</p>}
            {e.improvements.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="text-faint">In your report:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                  {e.improvements.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          ← Back
        </button>
        {step < STAGES.length - 1 && (
          <button type="button" className="btn btn-accent" onClick={() => setStep((s) => s + 1)}>
            Next: {STAGES[step + 1]} →
          </button>
        )}
      </div>
    </div>
  );
}
