"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerEvaluation, AskedQuestion } from "@/lib/interview/types";
import type { VideoMetrics } from "@/lib/video/analysis";
import type { VoiceMetrics } from "@/lib/voice/prosody";
import { Interviewer } from "./Interviewer";
import { useCamera, type LiveIssue } from "./useCamera";
import { decideTurn } from "@/lib/voice/turn";
import { useVoice } from "./useVoice";

type Phase = "intro" | "asking" | "ready" | "listening" | "submitting" | "reacting" | "finishing";

type Props = {
  id: string;
  title: string;
  /** How Arjun introduces his team ("the platform team"). */
  team: string;
  provider: string;
  total: number;
  answered: number;
  question: AskedQuestion;
};

export const INTERVIEWER = "Arjun";

/** Said the moment an answer ends, while it is being graded, so there is never dead air. */
const ACKS = ["Okay.", "Mm-hm, okay.", "Alright.", "Got it.", "Okay, thank you."];
const NOT_CAUGHT = "Sorry, I didn't catch that. Could you say it again?";
const CAMERA_OFF = "I can't see you at the moment. If you can, please turn your camera on, so it feels like the real thing.";
/** What he says, mid-answer, when the camera shows a problem a real interviewer would mention. */
const ALERTS: Record<LiveIssue, string> = {
  tilted: "Sorry to interrupt. It looks like you're lying down. Could you sit up and face the camera?",
  gone: "Sorry, I can't see you right now. Could you come back into the frame?",
  away: "Quick note: try to look at the camera while you answer.",
};
const ALERT_LABEL: Record<LiveIssue, string> = { tilted: "Sit up and face the camera", gone: "You're out of the frame", away: "Look at the camera" };

const opening = (team: string, total: number) =>
  `Hi, I'm ${INTERVIEWER}. I lead ${team} here. Thanks for making the time today. We'll go through about ${total} questions, so roughly ${Math.max(10, total * 3)} minutes. Take your time and think out loud. Let's start.`;

/** Drops a leading "Okay." from his reaction when he has just said one. */
const afterAck = (line: string) => {
  const rest = line.replace(/^(okay|alright|right|got it|mm-hm)[,.!]?\s*/i, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : "";
};

const CLOSING_ASK = "That's all my questions from my side. Before we wrap up, do you have any questions for me?";
const CUT_IN = "Sorry to cut in. In the interest of time, let me stop you there.";

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

export function Room({ id, title, team, provider, total, answered, question: initial }: Props) {
  const router = useRouter();
  const voice = useVoice();
  const camera = useCamera();
  const [question, setQuestion] = useState(initial);
  const [count, setCount] = useState(answered);
  const [phase, setPhase] = useState<Phase>("intro");
  const [elapsed, setElapsed] = useState(0);
  const [callSec, setCallSec] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const callStart = useRef<number>(0);
  const asked = useRef(0);
  const nudged = useRef(false);
  const turnBusy = useRef(false);
  /** True once the questions are done and he has asked "any questions for me?". */
  const closing = useRef(false);
  /** Camera problems already mentioned out loud, and whether he is mid-interjection. */
  const alerted = useRef(new Set<LiveIssue>());
  const alerting = useRef(false);
  const transcript = useRef("");
  transcript.current = `${voice.finalText} ${voice.interim}`.trim();

  const sttOk = voice.supported?.stt ?? false;
  // Voice only, like a real interview: browsers without speech recognition can't join.
  const noVoice = voice.supported !== null && !sttOk;

  // Answer timer, and the call clock.
  useEffect(() => {
    if (phase !== "listening") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "intro") return;
    const t = setInterval(() => setCallSec(Math.round((Date.now() - callStart.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Fetch his fixed lines early, so he starts talking the moment you join and never pauses to load.
  useEffect(() => {
    for (const line of [answered === 0 ? opening(team, total) : "Welcome back. Let's pick up where we left off.", initial.text, ...ACKS, CLOSING_ASK, CAMERA_OFF, "Next question.", "Let's move on."]) voice.prefetch(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback(
    async (text: string) => {
      if (!text) return;
      setCaption(text);
      if (voice.supported?.tts) await voice.speak(text);
    },
    [voice],
  );

  /** Opens the microphone for the candidate's turn. If it can't open, the call pauses until it can. */
  const listen = useCallback(async () => {
    voice.silence();
    startedAt.current = Date.now();
    nudged.current = false;
    turnBusy.current = false;
    alerted.current.delete("tilted");
    alerted.current.delete("gone");
    setElapsed(0);
    if (await voice.start()) {
      setPhase("listening");
      camera.startAnalysis();
    } else {
      setPhase("ready");
    }
  }, [voice, camera]);

  const ask = useCallback(
    async (q: AskedQuestion) => {
      setError(null);
      setPhase("asking");
      const n = asked.current++;
      // The opening, like a real call: who he is, what to expect, then the first question.
      const intro = n === 0 ? (answered === 0 ? opening(team, total) : "Welcome back. Let's pick up where we left off.") : lead(q, n);
      if (intro) await say(intro);
      if (n === 0 && !camera.on) await say(CAMERA_OFF);
      await say(q.text);
      await listen();
    },
    [say, listen, answered, team, total, camera.on],
  );

  async function join() {
    callStart.current = Date.now();
    await ask(question);
  }

  /** Sends an answer, lets the interviewer react, then moves straight on, like a real conversation. */
  const send = useCallback(
    async (answer: string, durationSec: number, measured: { voice?: VoiceMetrics | null; video?: VideoMetrics | null } = {}) => {
      setPhase("submitting");
      // Like a person, he acknowledges straight away while he thinks about the answer.
      const ack = say(ACKS[count % ACKS.length]);
      const res = await fetch(`/api/interviews/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answer,
          durationSec: Math.round(durationSec * 10) / 10,
          ...(measured.voice ? { voice: measured.voice } : {}),
          ...(measured.video ? { video: measured.video } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      await ack;
      if (!res.ok) {
        setError(data.error ?? "Could not submit your answer.");
        setPhase("ready");
        return;
      }
      const evaluation = data.evaluation as AnswerEvaluation;
      const next = data.next as AskedQuestion | null;
      setCount((c) => c + 1);
      if (next) voice.prefetch(next.text);
      else voice.prefetch(CLOSING_ASK);
      setPhase("reacting");
      // Neutral reactions ("Okay, thanks.") are already covered by the acknowledgement; anything
      // with substance (conduct, a thin answer) is said out loud.
      const reaction = afterAck(evaluation.reaction ?? "");
      if (reaction && (evaluation.redFlags?.length || reaction.length > 24)) await say(reaction);
      if (next) {
        setQuestion(next);
        await ask(next);
        return;
      }
      // The end of a real interview: his questions are done, now it's yours.
      closing.current = true;
      setPhase("asking");
      await say(CLOSING_ASK);
      await listen();
    },
    [id, voice, say, ask, listen, count],
  );

  /** His reply to the candidate's question, then goodbye, then the written feedback. */
  const closeOut = useCallback(
    async (asked: string) => {
      setPhase("finishing");
      setCaption(null);
      const res = await fetch(`/api/interviews/${id}/closing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: asked }) });
      const data = await res.json().catch(() => ({}));
      await say(res.ok && data.closing?.reply ? data.closing.reply : "Thanks again for your time today, it was good talking to you.");
      camera.stop();
      voice.release();
      router.push(`/report/${id}`);
      router.refresh();
    },
    [id, say, camera, router, voice],
  );

  /** Ends the candidate's spoken turn and submits it. */
  const finishTurn = useCallback(
    async (fallback?: string, cutIn = false) => {
      if (turnBusy.current) return;
      turnBusy.current = true;
      const { text, voice: measured } = voice.stop();
      const video = camera.stopAnalysis();
      if (cutIn) await say(CUT_IN);
      if (closing.current) {
        await closeOut(text.trim() || fallback || "");
        return;
      }
      const answer = text.trim() || fallback || "";
      if (!answer) {
        await say(NOT_CAUGHT);
        await listen();
        return;
      }
      await send(answer, (Date.now() - startedAt.current) / 1000, { voice: measured, video });
    },
    [voice, camera, say, listen, send, closeOut],
  );

  // The newest versions of everything the turn loop needs. The loop reads them through this ref
  // so it is not torn down and restarted on every render: the microphone level re-renders the
  // page many times a second, which would otherwise stop the loop from ever ticking.
  const live = useRef({ voice, camera, finishTurn, say, listen, questionText: question.text });
  live.current = { voice, camera, finishTurn, say, listen, questionText: question.text };

  /** Mentions a camera problem out loud, once, the way an interviewer would, then keeps listening. */
  const interject = (issue: LiveIssue) => {
    const { voice, say } = live.current;
    alerting.current = true;
    alerted.current.add(issue);
    void voice.hold(() => say(ALERTS[issue])).finally(() => {
      alerting.current = false;
    });
  };

  // While the candidate talks, decide several times a second whether their turn is over.
  useEffect(() => {
    if (phase !== "listening") return;
    const iv = setInterval(() => {
      if (turnBusy.current || alerting.current) return;
      const { voice, camera, finishTurn, say, listen, questionText } = live.current;
      const issue = camera.live?.issue;
      if (issue && !alerted.current.has(issue)) {
        interject(issue);
        return;
      }
      // A short "No, thanks" is a complete reply to "any questions for me?".
      if (closing.current && transcript.current && voice.quietFor() >= 2500) {
        void finishTurn();
        return;
      }
      const d = decideTurn({ transcript: transcript.current, quietMs: voice.quietFor(), sinceStartMs: Date.now() - startedAt.current, nudged: nudged.current });
      if (d === "end") void finishTurn();
      else if (d === "cut-in") void finishTurn(undefined, true);
      else if (d === "give-up") void finishTurn(closing.current ? "" : "I don't have an answer for this one.");
      else if (d === "repeat" || d === "nudge") {
        turnBusy.current = true;
        const line = d === "repeat" ? `Sure. ${closing.current ? "Do you have any questions for me?" : questionText}` : "Take your time. Whenever you're ready.";
        voice.stop();
        camera.stopAnalysis();
        void (async () => {
          await say(line);
          await listen();
          if (d === "nudge") nudged.current = true;
        })();
      }
    }, 250);
    return () => clearInterval(iv);
  }, [phase]);

  async function endEarly() {
    turnBusy.current = true;
    voice.silence();
    if (voice.listening) voice.stop();
    voice.release();
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
  const qNumber = Math.min(phase === "reacting" || phase === "finishing" ? count : count + 1, total);

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
            A live conversation with {INTERVIEWER}: he asks, you just talk, and when you pause he takes it from there, reacting to what you actually said and moving on, like a real interviewer. {total - answered} question{total - answered === 1 ? "" : "s"}, with follow-ups when an answer needs one.
          </p>
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            <li>• Like the real thing: he introduces himself, asks his questions with follow-ups, then asks if you have any questions for him. Scores and feedback come only at the end.</li>
            <li>• Voice only. No typing, no buttons, and one take per answer: once you stop talking, it counts.</li>
            <li>• Stop talking for a couple of seconds and he&apos;ll respond. Say &ldquo;that&apos;s it&rdquo; to finish sooner. Didn&apos;t catch the question? Ask him to repeat it, out loud.</li>
            <li>• Expect brutally honest feedback at the end, including whether a real panel would move you to the next round.</li>
            <li>• Turn your camera on for feedback on eye contact, expression and posture.</li>
            <li>• Video is analysed on this device and never uploaded or saved.</li>
          </ul>
          {camera.error && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{camera.error}</p>}
          {noVoice && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">This interview is voice only, and this browser can&apos;t listen. Open it in Chrome or Edge on a computer.</p>}
          <p className="mt-3 text-xs text-faint">{provider === "ai" ? "Graded by Gemini, with measured delivery metrics." : "Graded with transparent rule-based scoring."}</p>
          <button className="btn btn-accent mt-5" onClick={join} disabled={noVoice}>
            Join interview
          </button>
        </div>
      </div>
    );
  }

  // ---------- the call ----------
  const yourCaption = listening ? transcript.current : "";
  const status =
    phase === "asking" ? `${INTERVIEWER} is speaking` : listening ? (closing.current ? "Your turn: ask him anything" : "Your turn: just talk") : phase === "submitting" ? `${INTERVIEWER} is thinking…` : phase === "reacting" ? `${INTERVIEWER} is responding` : phase === "finishing" ? "Wrapping up" : "Microphone is off";
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
            <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs">{INTERVIEWER} · Interviewer</span>
            {phase === "submitting" && (
              <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-xs">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white [animation-delay:300ms]" />
              </span>
            )}
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
            {camera.on && listening && camera.live?.issue && (
              <span role="alert" className="absolute inset-x-0 top-0 bg-[#d97a1e] px-3 py-1.5 text-center text-sm font-medium text-[#1a1206]">
                {ALERT_LABEL[camera.live.issue]}
              </span>
            )}
            {camera.on && listening && camera.live && !camera.live.issue && (
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
              {caption ?? question.text}
            </p>
          )}
          <p className="mt-1 text-xs uppercase tracking-wider text-white/40">{status}</p>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 px-4 py-3">
          {listening && (
            <span className="flex h-12 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-[#0f1115]" aria-label="Microphone is on">
              {Icon.mic}
              <span className="tabular-nums">{mm(elapsed)}</span>
            </span>
          )}
          {phase === "ready" && (
            <CallButton label="Turn microphone on" onClick={() => void listen()} wide>
              <span className="flex items-center gap-2 text-sm font-medium">
                {Icon.mic}
                Turn microphone on
              </span>
            </CallButton>
          )}
          <CallButton label={camera.on ? "Turn camera off" : "Turn camera on"} onClick={() => (camera.on ? camera.stop() : void camera.start())} active={camera.on}>
            {camera.on ? Icon.cam : Icon.camOff}
          </CallButton>
          <CallButton label="Leave interview" onClick={endEarly} danger disabled={phase === "finishing"} wide>
            <span className="flex items-center gap-2 text-sm font-medium">{Icon.leave} Leave</span>
          </CallButton>
        </div>
      </div>

      {(error || voice.error || camera.error) && (
        <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error ?? voice.error ?? camera.error}
        </p>
      )}

      {phase === "finishing" && <p className="mt-4 text-center text-sm text-muted">Building your report…</p>}
    </div>
  );
}
