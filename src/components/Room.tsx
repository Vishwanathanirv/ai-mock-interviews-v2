"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerEvaluation, AskedQuestion } from "@/lib/interview/types";
import type { VideoMetrics } from "@/lib/video/analysis";
import type { VoiceMetrics } from "@/lib/voice/prosody";
import { Interviewer } from "./Interviewer";
import { ScorePill } from "./ScoreRing";
import { useCamera } from "./useCamera";
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

const INTERVIEWER = "Maya";

/** What a person would say after hearing an answer, before moving on. */
function acknowledge(score: number, seed: number) {
  const lines = score >= 75 ? ["Great, thank you.", "That's a strong answer, thanks.", "Nice, that's clear."] : score >= 50 ? ["Okay, thanks.", "Alright, got it.", "Thanks for that."] : ["Okay, thank you.", "Alright, let's keep going.", "Thanks, that's fine."];
  return lines[seed % lines.length];
}

function lead(q: AskedQuestion, n: number) {
  if (q.isFollowUp) return "I'd like to dig into that a little more.";
  return n === 0 ? "" : ["Next question.", "Let's move on.", "Okay, here's the next one."][n % 3];
}

const Icon = {
  mic: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  cam: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5l5-3v9l-5-3z" />
    </svg>
  ),
  camOff: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 10.5l5-3v9l-5-3M3 6h9.5A2.5 2.5 0 0 1 15 8.5V16M3 3l18 18M3 6v9.5A2.5 2.5 0 0 0 5.5 18H14" />
    </svg>
  ),
  replay: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
    </svg>
  ),
  keyboard: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  ),
  leave: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M12 9c-3.3 0-6.4.9-8.9 2.6-.6.4-.8 1.2-.5 1.8l1.2 2.2c.3.6 1 .8 1.6.6l2.8-1c.5-.2.8-.7.8-1.2v-1.9c1-.3 2-.4 3-.4s2 .1 3 .4V14c0 .5.3 1 .8 1.2l2.8 1c.6.2 1.3 0 1.6-.6l1.2-2.2c.3-.6.1-1.4-.5-1.8C18.4 9.9 15.3 9 12 9z" />
    </svg>
  ),
};

function CallButton({ label, onClick, active, danger, disabled, children, wide }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; disabled?: boolean; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-12 place-items-center rounded-full transition disabled:opacity-40 ${wide ? "px-5" : "w-12"} ${danger ? "bg-[#d93a2f] text-white hover:bg-[#c0322a]" : active ? "bg-accent text-[#0f1115]" : "bg-white/10 text-white hover:bg-white/15"}`}
    >
      {children}
    </button>
  );
}

export function Room({ id, title, provider, total, answered, question: initial }: Props) {
  const router = useRouter();
  const voice = useVoice();
  const camera = useCamera();
  const [question, setQuestion] = useState(initial);
  const [count, setCount] = useState(answered);
  const [phase, setPhase] = useState<Phase>("intro");
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [callSec, setCallSec] = useState(0);
  const [feedback, setFeedback] = useState<AnswerEvaluation | null>(null);
  const [pendingNext, setPendingNext] = useState<AskedQuestion | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [caption, setCaption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const callStart = useRef<number>(0);
  const spokenSec = useRef(0);
  const voiceMetrics = useRef<VoiceMetrics | null>(null);
  const videoMetrics = useRef<VideoMetrics | null>(null);
  const asked = useRef(0);

  const sttOk = voice.supported?.stt ?? false;
  const useTyping = typing || (voice.supported !== null && !sttOk);

  // Answer timer, and the call clock.
  useEffect(() => {
    if (phase !== "listening" && !(phase === "ready" && useTyping)) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase, useTyping]);
  useEffect(() => {
    if (phase === "intro") return;
    const t = setInterval(() => setCallSec(Math.round((Date.now() - callStart.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Fetch the opening question's voice early so the first line starts without a gap.
  useEffect(() => {
    if (voiceOn) voice.prefetch(initial.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback(
    async (text: string) => {
      if (!text) return;
      setCaption(text);
      if (voiceOn && voice.supported?.tts) await voice.speak(text);
    },
    [voice, voiceOn],
  );

  const ask = useCallback(
    async (q: AskedQuestion) => {
      setDraft("");
      setElapsed(0);
      setFeedback(null);
      setError(null);
      setPhase("asking");
      const intro = lead(q, asked.current++);
      if (intro) await say(intro);
      await say(q.text);
      startedAt.current = Date.now();
      setPhase("ready");
    },
    [say],
  );

  async function join() {
    callStart.current = Date.now();
    await ask(question);
  }

  async function beginAnswer() {
    voice.silence();
    startedAt.current = Date.now();
    setElapsed(0);
    if (await voice.start()) {
      setPhase("listening");
      camera.startAnalysis();
    } else setTyping(true);
  }

  function stopAnswer() {
    const { text, voice: measured } = voice.stop();
    voiceMetrics.current = measured;
    videoMetrics.current = camera.stopAnalysis();
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
      body: JSON.stringify({
        answer,
        durationSec: Math.round(durationSec * 10) / 10,
        ...(!useTyping && voiceMetrics.current ? { voice: voiceMetrics.current } : {}),
        ...(!useTyping && videoMetrics.current ? { video: videoMetrics.current } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not submit your answer.");
      setPhase(useTyping ? "ready" : "review");
      return;
    }
    voiceMetrics.current = null;
    videoMetrics.current = null;
    setCount((c) => c + 1);
    setFeedback(data.evaluation);
    setPendingNext(data.next);
    setPhase("feedback");
    if (data.next && voiceOn) voice.prefetch(data.next.text);
    void say(acknowledge(data.evaluation.score, count));
  }

  async function next() {
    if (!pendingNext) {
      setPhase("finishing");
      camera.stop();
      router.push(`/report/${id}`);
      router.refresh();
      return;
    }
    voice.silence();
    setQuestion(pendingNext);
    await ask(pendingNext);
  }

  async function endEarly() {
    voice.silence();
    if (voice.listening) voice.stop();
    camera.stop();
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

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const listening = phase === "listening";
  const qNumber = Math.min(phase === "feedback" || phase === "finishing" ? count : count + 1, total);

  // ---------- lobby ----------
  if (phase === "intro") {
    return (
      <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-[1.25fr_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#0f1115]">
          {camera.on ? (
            <video ref={camera.attach} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-white/60">
              <div>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/10 text-white">{Icon.camOff}</div>
                <p className="mt-3">Camera is off</p>
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 p-4">
            <CallButton label={camera.on ? "Turn camera off" : "Turn camera on"} onClick={() => (camera.on ? camera.stop() : void camera.start())} active={camera.on}>
              {camera.on ? Icon.cam : Icon.camOff}
            </CallButton>
          </div>
        </div>
        <div>
          <p className="eyebrow">{title}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Ready to join?</h1>
          <p className="mt-2 text-muted">
            {INTERVIEWER} will ask {total - answered} question{total - answered === 1 ? "" : "s"}. Press the microphone to answer and again when you&apos;re done. You can check the transcript before sending.
          </p>
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            <li>• Turn your camera on for feedback on eye contact, expression and posture.</li>
            <li>• Video is analysed on this device and never uploaded or saved.</li>
          </ul>
          {camera.error && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{camera.error}</p>}
          {voice.supported && !sttOk && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Voice answers need Chrome or Edge. You can type your answers here instead.</p>}
          <label className="mt-5 flex w-fit cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} className="accent-[var(--accent)]" />
            Read questions aloud
          </label>
          <p className="mt-3 text-xs text-faint">{provider === "ai" ? "Graded by Gemini, with measured delivery metrics." : "Graded with transparent rule-based scoring."}</p>
          <button className="btn btn-accent mt-5" onClick={join}>
            Join interview
          </button>
        </div>
      </div>
    );
  }

  // ---------- the call ----------
  const yourCaption = listening ? `${voice.finalText} ${voice.interim}`.trim() : "";
  return (
    <div className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-2xl bg-[#0f1115] text-white">
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white/70 sm:px-5">
          <span className="truncate">{title}</span>
          <span className="flex items-center gap-3 whitespace-nowrap">
            <span>
              Question {qNumber} of {total}
            </span>
            {question.isFollowUp && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">Follow-up</span>}
            <span className="font-mono tabular-nums">{mm(callSec)}</span>
          </span>
        </div>

        <div className="grid gap-3 px-3 sm:grid-cols-2 sm:px-4">
          <div className={`relative aspect-video overflow-hidden rounded-xl ring-2 transition ${voice.speaking ? "ring-accent" : "ring-transparent"}`}>
            <Interviewer mouth={voice.mouth} speaking={voice.speaking} listening={listening} level={voice.level} />
            <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs">
              {INTERVIEWER} · Interviewer
            </span>
          </div>
          <div className={`relative aspect-video overflow-hidden rounded-xl bg-[#1a1d23] ring-2 transition ${listening ? "ring-accent" : "ring-transparent"}`}>
            {camera.on ? (
              <video ref={camera.attach} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            ) : (
              <div className="grid h-full place-items-center">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10 text-2xl font-semibold" style={{ transform: `scale(${1 + (listening ? voice.level * 0.4 : 0)})`, transition: "transform 80ms linear" }}>
                  You
                </div>
              </div>
            )}
            <span className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-black/55 px-2 py-1 text-xs">
              You
              {listening && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
            </span>
            {camera.on && listening && camera.live && (
              <span className={`absolute right-2 top-2 rounded-md px-2 py-1 text-xs ${camera.live.contact ? "bg-accent/85 text-[#0f1115]" : "bg-black/60 text-white/80"}`}>
                {!camera.live.face ? "Face not in view" : camera.live.contact ? "Eye contact" : "Look at the camera"}
              </span>
            )}
            {camera.on && camera.tracking === "loading" && <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white/70">Starting video analysis…</span>}
          </div>
        </div>

        {/* captions */}
        <div className="min-h-[5.5rem] px-5 py-4 text-center sm:px-10" aria-live="polite">
          {yourCaption ? (
            <p className="text-[1.05rem] leading-relaxed">
              <span className="text-white/50">You: </span>
              {voice.finalText} <span className="text-white/50">{voice.interim}</span>
            </p>
          ) : (
            <p key={caption ?? question.text} className="animate-rise mx-auto max-w-3xl text-[1.1rem] leading-relaxed sm:text-[1.2rem]">
              <span className="text-white/50">{INTERVIEWER}: </span>
              {phase === "feedback" || phase === "submitting" ? caption : question.text}
            </p>
          )}
          {listening && !yourCaption && <p className="mt-1 text-sm text-white/50">Listening… start speaking.</p>}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 px-4 py-3">
          {!useTyping && (phase === "ready" || phase === "asking" || listening) && (
            <CallButton label={listening ? "Done answering" : "Answer"} onClick={listening ? stopAnswer : beginAnswer} active={listening} disabled={phase === "asking"} wide>
              <span className="flex items-center gap-2 text-sm font-medium">
                {Icon.mic}
                {listening ? `Done · ${mm(elapsed)}` : phase === "asking" ? "Interviewer speaking…" : "Answer"}
              </span>
            </CallButton>
          )}
          <CallButton label={camera.on ? "Turn camera off" : "Turn camera on"} onClick={() => (camera.on ? camera.stop() : void camera.start())} active={camera.on}>
            {camera.on ? Icon.cam : Icon.camOff}
          </CallButton>
          <CallButton label="Repeat question" onClick={() => void say(question.text)} disabled={phase === "asking" || listening}>
            {Icon.replay}
          </CallButton>
          {sttOk && !listening && (
            <CallButton label={useTyping ? "Use voice instead" : "Type instead"} onClick={() => setTyping((t) => !t)} active={useTyping}>
              {Icon.keyboard}
            </CallButton>
          )}
          <CallButton label="Leave interview" onClick={endEarly} danger disabled={phase === "finishing" || phase === "submitting"} wide>
            <span className="flex items-center gap-2 text-sm font-medium">{Icon.leave} Leave</span>
          </CallButton>
        </div>
      </div>

      {/* answer and feedback panel under the call */}
      {(useTyping && (phase === "ready" || phase === "submitting" || phase === "asking")) || phase === "review" || (phase === "submitting" && !useTyping) ? (
        <section className="card mt-4 p-5">
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{useTyping ? "Type your answer as you would say it" : "Check the transcript, then send"}</span>
            <span className="font-mono tabular-nums">{mm(elapsed)}</span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={useTyping ? 6 : 5}
            maxLength={6000}
            className="input mt-3 h-auto resize-y py-3 leading-relaxed"
            aria-label={useTyping ? "Your answer" : "Transcript of your answer"}
            disabled={phase === "submitting" || phase === "asking"}
          />
          <div className="mt-4 flex flex-wrap justify-between gap-3">
            {!useTyping ? (
              <button type="button" className="btn btn-ghost h-10 text-sm" onClick={beginAnswer} disabled={phase === "submitting"}>
                Re-record
              </button>
            ) : (
              <span />
            )}
            <button className="btn btn-primary" onClick={submit} disabled={phase === "submitting" || phase === "asking"}>
              {phase === "submitting" ? "Grading…" : useTyping ? "Submit answer" : "Send answer"}
            </button>
          </div>
          {(error || voice.error) && (
            <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {error ?? voice.error}
            </p>
          )}
        </section>
      ) : null}
      {!useTyping && (error || voice.error || camera.error) && phase !== "review" && (
        <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error ?? voice.error ?? camera.error}
        </p>
      )}

      {phase === "feedback" && feedback && (
        <section className="card mt-4 animate-rise p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ScorePill score={feedback.score} />
              <span className="font-medium">Quick feedback</span>
            </div>
            <span className="text-xs text-faint">
              {feedback.metrics.words} words{feedback.metrics.wpm ? ` · ${feedback.metrics.wpm} wpm` : ""}
              {feedback.metrics.fillerCount ? ` · ${feedback.metrics.fillerCount} fillers` : ""}
              {feedback.metrics.voice?.pitchSdSemitones != null ? ` · pitch varied ${feedback.metrics.voice.pitchSdSemitones} st${feedback.metrics.voice.monotone ? " (flat)" : ""}` : ""}
              {feedback.metrics.video ? ` · eye contact ${feedback.metrics.video.eyeContactPct}%` : ""}
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
        </section>
      )}
      {phase === "finishing" && <p className="mt-4 text-center text-sm text-muted">Building your report…</p>}
    </div>
  );
}
