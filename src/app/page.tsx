import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { GuestButton } from "@/components/GuestButton";
import { Bar, ScoreRing } from "@/components/ScoreRing";

const steps = [
  { n: "01", t: "Pick the role", d: "Six tracks from frontend to security, four seniority levels, technical, behavioural or mixed." },
  { n: "02", t: "Answer out loud", d: "The interviewer speaks each question. You answer by voice, with a live transcript, or type if you prefer." },
  { n: "03", t: "Get a real debrief", d: "Scores for content, depth, structure and delivery, with what you covered, what you missed and what to study next." },
];

const features = [
  { t: "Adaptive questioning", d: "Strong answers raise the difficulty. Gaps get a follow-up, just like a real interviewer would probe." },
  { t: "Measured delivery", d: "Speaking pace, filler words and hedging are measured from your answer, not guessed." },
  { t: "STAR coaching", d: "Behavioural answers are checked for situation, task, action and result, with the missing parts named." },
  { t: "Works without keys", d: "Runs fully offline with transparent rule-based scoring. Add a Gemini key for AI grading and follow-ups." },
  { t: "Progress over time", d: "Every session is saved, so you can see your scores climb and revisit any answer." },
  { t: "Private by design", d: "Hashed passwords, signed http-only sessions and rate limits. Audio never leaves your browser." },
];

export default function Home() {
  return (
    <>
      <AppHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 md:grid-cols-[1.15fr_0.85fr] md:pt-24">
          <div className="animate-rise">
            <p className="eyebrow">AI mock interviews · voice first</p>
            <h1 className="mt-5 font-display text-[clamp(2.6rem,6vw,4.4rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
              Practise the interview <span className="text-accent">out loud</span>, before it counts.
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted">
              An interviewer that listens, follows up on what you missed, and tells you exactly how to sound sharper next time.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <GuestButton />
              <Link href="/signup" className="btn btn-ghost">
                Create a free account
              </Link>
            </div>
            <p className="mt-4 text-sm text-faint">Best in Chrome or Edge for voice. Typing works everywhere.</p>
          </div>

          <div className="card animate-rise p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.35)] [animation-delay:120ms]" aria-label="Example report">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Sample debrief</span>
              <span className="rounded-full bg-good-soft px-2.5 py-1 text-xs font-medium text-good">Promising</span>
            </div>
            <div className="mt-5 flex items-center gap-6">
              <ScoreRing score={72} size={112} stroke={9} />
              <div className="flex-1 space-y-3">
                <Bar label="content" value={78} />
                <Bar label="depth" value={64} />
                <Bar label="structure" value={81} />
                <Bar label="delivery" value={66} />
              </div>
            </div>
            <div className="mt-6 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed">
              <p className="font-medium">Next time</p>
              <p className="mt-1 text-muted">Bring in idempotency keys when you talk about webhooks, and cut &ldquo;basically&rdquo;: you said it 6 times.</p>
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-surface/60">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n}>
                <div className="font-mono text-xs text-faint">{s.n}</div>
                <h2 className="mt-3 font-display text-xl font-semibold tracking-tight">{s.t}</h2>
                <p className="mt-2 leading-relaxed text-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="eyebrow">What makes it different</p>
          <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight">Feedback you can act on, not a vague grade.</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.t} className="bg-surface p-6">
                <h3 className="font-medium">{f.t}</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">{f.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
