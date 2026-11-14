"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTURE_WORKLET } from "@/lib/voice/capture";
import { ProsodyTracker, type VoiceMetrics } from "@/lib/voice/prosody";



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
 * Browser-native speech: recognition for the candidate, synthesis for the interviewer, a live
 * microphone level for the visualiser, and voice analytics (pitch, pauses, loudness) computed
 * from the raw samples. No audio is uploaded; only the final text and summary numbers are sent.
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
  const tracker = useRef<ProsodyTracker | null>(null);
  const node = useRef<AudioNode | null>(null);

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
    node.current?.disconnect();
    node.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
  }

  async function startMeter() {
    try {
      // Noise suppression and auto gain flatten pitch and loudness, so they stay off for analysis.
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      ctx.current = new AudioContext();
      const source = ctx.current.createMediaStreamSource(stream.current);
      const t = new ProsodyTracker(ctx.current.sampleRate);
      tracker.current = t;
      const onBlock = (block: Float32Array) => {
        t.push(block);
        let sum = 0;
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
        setLevel(Math.min(1, Math.sqrt(sum / block.length) * 4));
      };
      if (ctx.current.audioWorklet) {
        const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
        await ctx.current.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const w = new AudioWorkletNode(ctx.current, "mv-capture");
        w.port.onmessage = (e: MessageEvent<Float32Array>) => onBlock(e.data);
        source.connect(w);
        node.current = w;
      } else {
        // Older browsers: ScriptProcessor delivers the same contiguous blocks.
        const sp = ctx.current.createScriptProcessor(2048, 1, 1);
        sp.onaudioprocess = (e) => onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
        source.connect(sp);
        sp.connect(ctx.current.destination);
        node.current = sp;
      }
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

  const stop = useCallback((): { text: string; voice: VoiceMetrics | null } => {
    wantListening.current = false;
    rec.current?.stop();
    stopMeter();
    setListening(false);
    const text = `${finalRef.current} ${interimRef.current}`.trim();
    interimRef.current = "";
    setInterim("");
    const voice = tracker.current?.summary() ?? null;
    tracker.current = null;
    return { text, voice: voice && voice.speakingSec >= 3 ? voice : null };
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
