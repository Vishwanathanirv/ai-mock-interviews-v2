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
  /** When speech was last heard (audio level or new words), for end-of-turn detection. */
  const heardAt = useRef(0);
  const noiseFloor = useRef(0.02);
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
      void playCtx.current?.close().catch(() => {});
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
        const rms = Math.sqrt(sum / block.length);
        setLevel(Math.min(1, rms * 4));
        // Adaptive noise floor: follows quiet rooms down quickly and noisy ones up slowly.
        noiseFloor.current = rms < noiseFloor.current ? rms : noiseFloor.current * 0.995 + rms * 0.005;
        if (rms > Math.max(0.012, noiseFloor.current * 3.2)) heardAt.current = performance.now();
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
    heardAt.current = performance.now();
    noiseFloor.current = 0.02;
    interimRef.current = "";
    setFinalText("");
    setInterim("");
    if (!(await startMeter())) return false;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      heardAt.current = performance.now();
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

  // ---------- the interviewer's voice ----------
  // Natural (Gemini) speech is played through Web Audio so its loudness can drive the avatar's
  // mouth. If the server has no voice configured or fails, the browser's voice takes over.
  const [mouth, setMouth] = useState(0);
  const [voiceKind, setVoiceKind] = useState<"natural" | "browser">("browser");
  const natural = useRef<"unknown" | "on" | "off">("unknown");
  const playCtx = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null);
  const mouthRaf = useRef<number | null>(null);
  const audioCache = useRef(new Map<string, Promise<ArrayBuffer | null>>());

  const fetchSpeech = useCallback((text: string): Promise<ArrayBuffer | null> => {
    if (natural.current === "off") return Promise.resolve(null);
    const hit = audioCache.current.get(text);
    if (hit) return hit;
    const p = fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) })
      .then(async (res) => {
        if (res.status === 503) natural.current = "off";
        if (!res.ok) return null;
        natural.current = "on";
        return res.arrayBuffer();
      })
      .catch(() => null);
    audioCache.current.set(text, p);
    p.then((b) => {
      if (!b) audioCache.current.delete(text);
    });
    return p;
  }, []);

  /** Fetches the next line in the background so it starts without a pause. */
  const prefetch = useCallback((text: string) => void fetchSpeech(text), [fetchSpeech]);

  const stopMouth = () => {
    if (mouthRaf.current) cancelAnimationFrame(mouthRaf.current);
    mouthRaf.current = null;
    setMouth(0);
  };

  const speakBrowser = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      u.voice =
        voices.find((v) => /en[-_](US|GB|IN)/i.test(v.lang) && /natural|neural|online/i.test(v.name)) ??
        voices.find((v) => /en[-_](US|GB)/i.test(v.lang) && /google|samantha|daniel/i.test(v.name)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
      u.rate = 0.98;
      // The browser gives no audio level, so the mouth follows word boundaries instead.
      u.onboundary = () => {
        setMouth(0.8);
        setTimeout(() => setMouth(0.25), 120);
      };
      const done = () => {
        setSpeaking(false);
        setMouth(0);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      setVoiceKind("browser");
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    });
  }, []);

  const speak = useCallback(
    async (text: string) => {
      // Create or resume the audio context now, while we are still inside the click that asked for speech.
      if (!playCtx.current) playCtx.current = new AudioContext();
      void playCtx.current.resume().catch(() => {});
      playing.current?.stop();
      if (natural.current !== "off") setSpeaking(true);
      const bytes = await fetchSpeech(text);
      const ctx = playCtx.current;
      if (bytes && ctx) {
        try {
          const buffer = await ctx.decodeAudioData(bytes.slice(0));
          return await new Promise<void>((resolve) => {
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            analyser.connect(ctx.destination);
            const data = new Float32Array(analyser.fftSize);
            const tick = () => {
              analyser.getFloatTimeDomainData(data);
              let s = 0;
              for (const v of data) s += v * v;
              setMouth(Math.min(1, Math.sqrt(s / data.length) * 6));
              mouthRaf.current = requestAnimationFrame(tick);
            };
            src.onended = () => {
              if (playing.current === src) playing.current = null;
              stopMouth();
              setSpeaking(false);
              resolve();
            };
            playing.current = src;
            setVoiceKind("natural");
            setSpeaking(true);
            src.start();
            tick();
          });
        } catch {
          // Undecodable audio: fall through to the browser voice.
        }
      }
      return speakBrowser(text);
    },
    [fetchSpeech, speakBrowser],
  );

  const silence = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    try {
      playing.current?.stop();
    } catch {
      /* already stopped */
    }
    playing.current = null;
    stopMouth();
    setSpeaking(false);
  }, []);

  /** Milliseconds since the candidate last made a sound or produced a word. */
  const quietFor = useCallback(() => performance.now() - heardAt.current, []);

  return { supported, listening, speaking, finalText, interim, level, error, start, stop, speak, silence, setError, mouth, voiceKind, prefetch, quietFor, stream: () => stream.current };
}
