"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerEvaluation, AskedQuestion } from "@/lib/interview/types";
import type { VoiceMetrics } from "@/lib/voice/prosody";
import { ScorePill } from "./ScoreRing";
import { useVoice } from "./useVoice";

type Phase = "intro" | "asking" | "ready" | "listening" | "review" | "submitting" | "feedback" | "finishing";

type Props = {
  id: string;
  title: string;
  provider: string;
  total: number;
  answered: number;
  question: AskedQuestion;
};

function Orb({ level, mode }: { level: number; mode: "idle" | "speaking" | "listening" }) {
  const scale = mode === "listening" ? 1 + level * 0.55 : 1;
  return (
    <div className="relative grid h-40 w-40 place-items-center" aria-hidden>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: mode === "listening" ? "var(--accent-soft)" : "var(--surface-2)",
          animation: mode === "speaking" ? "breathe 1.6s ease-in-out infinite" : undefined,
          transform: `scale(${scale})`,
          transition: "transform 80ms linear, background .3s",
        }}
      />
      <div className="relative grid h-24 w-24 place-items-center rounded-full bg-ink text-bg shadow-lg">
        {mode === "listening" ? (
          <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        ) : (
          <div className="flex items-end gap-1">
            {[0.5, 0.9, 0.65, 1, 0.55].map((h, i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-bg"
                style={{ height: `${(mode === "speaking" ? h : 0.35) * 30}px`, animation: mode === "speaking" ? `breathe ${0.7 + i * 0.12}s ease-in-out infinite` : undefined }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Room({ id, title, provider, total, answered, question: initial }: Props) {
  const router = useRouter();
  const voice = useVoice();
  const [question, setQuestion] = useState(initial);
  const [count, setCount] = useState(answered);
  const [phase, setPhase] = useState<Phase>("intro");
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<AnswerEvaluation | null>(null);
  const [pendingNext, setPendingNext] = useState<AskedQuestion | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const spokenSec = useRef(0);
  const voiceMetrics = useRef<VoiceMetrics | null>(null);

  const sttOk = voice.supported?.stt ?? false;
  const useTyping = typing || (voice.supported !== null && !sttOk);

  // Timer while answering.
  useEffect(() => {
    if (phase !== "listening" && !(phase === "ready" && useTyping)) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase, useTyping]);

  const ask = useCallback(
    async (q: AskedQuestion) => {
      setDraft("");
      setElapsed(0);
      setFeedback(null);
      setError(null);
      setPhase("asking");
      if (voiceOn && voice.supported?.tts) await voice.speak(q.text);
      startedAt.current = Date.now();
      setPhase("ready");
    },
    [voice, voiceOn],
  );

  async function beginAnswer() {
    voice.silence();
    startedAt.current = Date.now();
    setElapsed(0);
    if (await voice.start()) setPhase("listening");
    else setTyping(true);
  }

  function stopAnswer() {
    const { text, voice: measured } = voice.stop();
    voiceMetrics.current = measured;
    spokenSec.current = (Date.now() - startedAt.current) / 1000;
    setDraft(text);
    setPhase("review");
  }

  async function submit() {
    const answer = draft.trim();
    if (!answer) {
      setError("Say or type an answer first.");
      return;
    }
    const durationSec = useTyping ? 0 : spokenSec.current; // typed answers have no speaking pace
    setPhase("submitting");
    const res = await fetch(`/api/interviews/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer, durationSec: Math.round(durationSec * 10) / 10, ...(!useTyping && voiceMetrics.current ? { voice: voiceMetrics.current } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not submit your answer.");
      setPhase(useTyping ? "ready" : "review");
      return;
    }
    setCount((c) => c + 1);
    setFeedback(data.evaluation);
    setPendingNext(data.next);
    setPhase("feedback");
  }

  async function next() {
    if (!pendingNext) {
      setPhase("finishing");
      router.push(`/report/${id}`);
      router.refresh();
      return;
    }
    setQuestion(pendingNext);
    await ask(pendingNext);
  }

  async function endEarly() {
    voice.silence();
    if (voice.listening) voice.stop();
    if (count === 0) {
      router.push("/dashboard");
      return;
    }
    setPhase("finishing");
    const res = await fetch(`/api/interviews/${id}/finish`, { method: "POST" });
    if (res.ok) {
      router.push(`/report/${id}`);
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Could not finish the interview.");
      setPhase("ready");
    }
  }

  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const orbMode = voice.speaking ? "speaking" : phase === "listening" ? "listening" : "idle";
  const progress = Math.min(100, (count / total) * 100);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{title}</p>
          <p className="mt-1 text-sm text-muted">
            Question {Math.min(phase === "feedback" || phase === "finishing" ? count : count + 1, total)} of {total}
            {question.isFollowUp && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">Follow-up</span>}
            <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs capitalize">{question.kind}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted">
            <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} className="accent-[var(--accent)]" />
            Read questions aloud
          </label>
          <button type="button" onClick={endEarly} className="btn btn-ghost h-9 px-4 text-sm" disabled={phase === "finishing" || phase === "submitting"}>
            End interview
          </button>
        </div>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={total}>
        <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-col items-center px-6 pb-8 pt-10 text-center sm:px-10">
          <Orb level={voice.level} mode={orbMode} />
          {phase === "intro" ? (
            <div className="mt-6 max-w-lg animate-rise">
              <h1 className="font-display text-2xl font-semibold tracking-tight">Ready when you are</h1>
              <p className="mt-2 text-muted">
                The interviewer will read each question. Press <b>Answer</b> and speak naturally, then press <b>Done</b>. You can fix the transcript before sending.
              </p>
              {voice.supported && !sttOk && (
                <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Voice answers need Chrome or Edge. You can type your answers here instead.</p>
              )}
              <p className="mt-3 text-xs text-faint">{provider === "ai" ? "Graded by Gemini, with measured delivery metrics." : "Graded with transparent rule-based scoring."}</p>
              <button className="btn btn-accent mt-6" onClick={() => ask(question)}>
                Begin interview
              </button>
            </div>
          ) : (
            <h1 key={question.id + question.text} className="mt-6 max-w-2xl animate-rise font-display text-[1.45rem] font-medium leading-snug tracking-tight sm:text-[1.6rem]" aria-live="polite">
              {question.text}
            </h1>
          )}
        </div>

        {phase !== "intro" && phase !== "feedback" && (
          <div className="border-t border-line bg-surface-2/50 px-6 py-6 sm:px-10">
            {useTyping ? (
              <div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  maxLength={6000}
                  placeholder="Type your answer as you would say it…"
                  className="input h-auto resize-y py-3 leading-relaxed"
                  aria-label="Your answer"
                  disabled={phase === "submitting" || phase === "asking"}
                />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    {sttOk && (
                      <button type="button" className="btn btn-ghost h-10 text-sm" onClick={() => setTyping(false)}>
                        Use voice instead
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost h-10 text-sm" onClick={() => voice.speak(question.text)} disabled={phase === "asking"}>
                      Repeat question
                    </button>
                  </div>
                  <button className="btn btn-primary" onClick={submit} disabled={phase === "submitting" || phase === "asking"}>
                    {phase === "submitting" ? "Grading…" : "Submit answer"}
                  </button>
                </div>
              </div>
            ) : phase === "listening" ? (
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-accent">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Listening
                  </span>
                  <span className="font-mono tabular-nums text-muted">{mm}</span>
                </div>
                <p className="mt-3 min-h-24 text-[1.05rem] leading-relaxed">
                  {voice.finalText}
                  <span className="text-faint"> {voice.interim}</span>
                  {!voice.finalText && !voice.interim && <span className="text-faint">Start speaking…</span>}
                </p>
                <div className="mt-4 flex justify-end">
                  <button className="btn btn-primary" onClick={stopAnswer}>
                    Done
                  </button>
                </div>
              </div>
            ) : phase === "review" || phase === "submitting" ? (
              <div>
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>Check the transcript, then send</span>
                  <span className="font-mono tabular-nums">{mm}</span>
                </div>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="input mt-3 h-auto resize-y py-3 leading-relaxed" aria-label="Transcript of your answer" disabled={phase === "submitting"} />
                <div className="mt-4 flex flex-wrap justify-between gap-3">
                  <button type="button" className="btn btn-ghost h-10 text-sm" onClick={beginAnswer} disabled={phase === "submitting"}>
                    Re-record
                  </button>
                  <button className="btn btn-primary" onClick={submit} disabled={phase === "submitting"}>
                    {phase === "submitting" ? "Grading…" : "Send answer"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button className="btn btn-accent" onClick={beginAnswer} disabled={phase === "asking"}>
                  {phase === "asking" ? "Interviewer speaking…" : "Answer"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => voice.speak(question.text)} disabled={phase === "asking"}>
                  Repeat question
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setTyping(true)}>
                  Type instead
                </button>
              </div>
            )}
            {(error || voice.error) && (
              <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
                {error ?? voice.error}
              </p>
            )}
          </div>
        )}

        {phase === "feedback" && feedback && (
          <div className="animate-rise border-t border-line px-6 py-6 sm:px-10">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ScorePill score={feedback.score} />
                <span className="font-medium">Quick feedback</span>
              </div>
              <span className="text-xs text-faint">
                {feedback.metrics.words} words{feedback.metrics.wpm ? ` · ${feedback.metrics.wpm} wpm` : ""}
                {feedback.metrics.fillerCount ? ` · ${feedback.metrics.fillerCount} fillers` : ""}
                {feedback.metrics.voice?.pitchSdSemitones != null ? ` · pitch varied ${feedback.metrics.voice.pitchSdSemitones} st${feedback.metrics.voice.monotone ? " (flat)" : ""}` : ""}
                {feedback.metrics.voice ? ` · ${feedback.metrics.voice.pauses} pause${feedback.metrics.voice.pauses === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-good-soft/70 p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-good">Worked well</div>
                <p className="mt-1.5 text-sm leading-relaxed">{feedback.strengths[0]}</p>
              </div>
              <div className="rounded-xl bg-warn-soft/70 p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-warn">Try next time</div>
                <p className="mt-1.5 text-sm leading-relaxed">{feedback.improvements[0] ?? "Keep this level up on the next question."}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button className="btn btn-primary" onClick={next} autoFocus>
                {pendingNext ? (pendingNext.isFollowUp ? "Answer the follow-up" : "Next question") : "See my report"}
              </button>
            </div>
          </div>
        )}
        {phase === "finishing" && <p className="border-t border-line px-6 py-5 text-center text-sm text-muted">Building your report…</p>}
      </section>
    </div>
  );
}
