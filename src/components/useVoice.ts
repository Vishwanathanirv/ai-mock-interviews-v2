"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser-native speech: recognition for the candidate, synthesis for the interviewer,
 * and a live microphone level for the visualiser. Nothing is uploaded; only the final text is sent.
 */
export function useVoice() {
  const [supported, setSupported] = useState<{ stt: boolean; tts: boolean } | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const rec = useRef<Recognition | null>(null);
  const wantListening = useRef(false);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  useEffect(() => {
    setSupported({ stt: Boolean(getRecognitionCtor()), tts: typeof window !== "undefined" && "speechSynthesis" in window });
    return () => {
      wantListening.current = false;
      rec.current?.abort();
      stopMeter();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function stopMeter() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
  }

  async function startMeter() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      ctx.current = new AudioContext();
      const analyser = ctx.current.createAnalyser();
      analyser.fftSize = 512;
      ctx.current.createMediaStreamSource(stream.current).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    } catch {
      setError("Microphone access was blocked. Allow it in the address bar, or type your answers instead.");
      return false;
    }
  }

  const start = useCallback(async () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return false;
    setError(null);
    finalRef.current = "";
    interimRef.current = "";
    setFinalText("");
    setInterim("");
    if (!(await startMeter())) return false;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current = `${finalRef.current} ${res[0].transcript}`.trim();
        else interimText += res[0].transcript;
      }
      interimRef.current = interimText;
      setFinalText(finalRef.current);
      setInterim(interimText);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening.current = false;
        setError("Speech recognition isn't allowed here. You can type your answer instead.");
      }
    };
    // Chrome ends recognition after a pause; restart until the user presses stop.
    r.onend = () => {
      if (wantListening.current) {
        try {
          r.start();
        } catch {
          /* already started */
        }
      } else setListening(false);
    };
    rec.current = r;
    wantListening.current = true;
    r.start();
    setListening(true);
    return true;
  }, []);

  const stop = useCallback((): string => {
    wantListening.current = false;
    rec.current?.stop();
    stopMeter();
    setListening(false);
    const text = `${finalRef.current} ${interimRef.current}`.trim();
    interimRef.current = "";
    setInterim("");
    return text;
  }, []);

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      u.voice =
        voices.find((v) => /en[-_](US|GB)/i.test(v.lang) && /natural|neural|google|samantha|daniel/i.test(v.name)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
      u.rate = 1.0;
      u.pitch = 1.0;
      u.onend = () => {
        setSpeaking(false);
        resolve();
      };
      u.onerror = () => {
        setSpeaking(false);
        resolve();
      };
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    });
  }, []);

  const silence = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, listening, speaking, finalText, interim, level, error, start, stop, speak, silence, setError };
}
