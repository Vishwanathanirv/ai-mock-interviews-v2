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

/** How long to wait for the natural voice before speaking with the browser's own voice. */
const NATURAL_WAIT_MS = 4500;

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
  /** When the transcript last changed, and when the microphone last heard something louder than the room. */
  const wordAt = useRef(0);
  const soundAt = useRef(0);
  /** Recent loudness levels, to learn how loud the room is when nobody is talking. */
  const recent = useRef<number[]>([]);
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

  /**
   * Opens the microphone once and keeps it open for the whole call, like a real video call, so
   * each new turn starts instantly instead of re-asking for the device. Samples only feed the
   * voice analysis while the candidate's turn is open.
   */
  async function startMeter() {
    if (stream.current?.active && ctx.current && ctx.current.state !== "closed") {
      tracker.current = new ProsodyTracker(ctx.current.sampleRate);
      void ctx.current.resume().catch(() => {});
      return true;
    }
    try {
      // Noise suppression and auto gain flatten pitch and loudness, so they stay off for analysis.
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      ctx.current = new AudioContext();
      const source = ctx.current.createMediaStreamSource(stream.current);
      tracker.current = new ProsodyTracker(ctx.current.sampleRate);
      const onBlock = (block: Float32Array) => {
        tracker.current?.push(block);
        let sum = 0;
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
        const rms = Math.sqrt(sum / block.length);
        if (!tracker.current) return; // between turns: nothing to measure
        setLevel(Math.min(1, rms * 4));
        // The room's own level is the quieter end of the last ~4 seconds (fans, AC, hum), so only
        // sound clearly above it counts as the candidate still talking.
        const r = recent.current;
        r.push(rms);
        if (r.length > 90) r.shift();
        const room = [...r].sort((a, b) => a - b)[Math.floor(r.length * 0.2)] ?? rms;
        if (r.length > 10 && rms > Math.max(0.015, room * 2.5)) soundAt.current = performance.now();
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
      setError("Microphone access was blocked. Allow it in the address bar, then turn the microphone on.");
      return false;
    }
  }

  const start = useCallback(async () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return false;
    setError(null);
    finalRef.current = "";
    wordAt.current = soundAt.current = performance.now();
    recent.current = [];
    interimRef.current = "";
    setFinalText("");
    setInterim("");
    if (!(await startMeter())) return false;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      const before = `${finalRef.current} ${interimRef.current}`;
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current = `${finalRef.current} ${res[0].transcript}`.trim();
        else interimText += res[0].transcript;
      }
      if (`${finalRef.current} ${interimText}` !== before) wordAt.current = performance.now();
      interimRef.current = interimText;
      setFinalText(finalRef.current);
      setInterim(interimText);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening.current = false;
        setError("Speech recognition isn't allowed here. Use Chrome or Edge on a computer.");
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
    setListening(false);
    setLevel(0);
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
      // The interviewer is a man, so prefer male English voices, natural-sounding ones first.
      const male = /\b(male|guy|daniel|david|mark|ravi|prabhat|james|george|ryan|thomas|alex|fred|aaron|arthur|oliver)\b/i;
      const english = voices.filter((v) => /^en/i.test(v.lang));
      u.voice =
        english.find((v) => male.test(v.name) && /natural|neural|online/i.test(v.name)) ??
        english.find((v) => /google uk english male/i.test(v.name)) ??
        english.find((v) => male.test(v.name)) ??
        english[0] ??
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
      // A real person doesn't go silent for long: if the natural voice is slow, use the browser's.
      // Longer lines take longer to synthesise, so they get a little more time.
      const wait = Math.min(12_000, Math.max(NATURAL_WAIT_MS, text.length * 10));
      const bytes = await Promise.race([fetchSpeech(text), new Promise<null>((r) => setTimeout(() => r(null), wait))]);
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

  /**
   * Milliseconds since the candidate stopped talking. Words are the main signal; sound only
   * covers the fraction of a second that recognition lags behind speech, so background noise can never
   * keep a turn open forever.
   */
  const quietFor = useCallback(() => {
    const lastSpoke = Math.max(wordAt.current, Math.min(soundAt.current, wordAt.current + 800));
    return performance.now() - lastSpoke;
  }, []);

  /**
   * Pauses listening while the interviewer says something mid-answer, so his words don't end up
   * in the candidate's transcript or voice analysis, then carries on with the same answer.
   */
  const hold = useCallback(async (during: () => Promise<void>) => {
    const r = rec.current;
    if (!r || !wantListening.current) return during();
    finalRef.current = `${finalRef.current} ${interimRef.current}`.trim();
    interimRef.current = "";
    wantListening.current = false;
    r.abort();
    const measuring = tracker.current;
    tracker.current = null;
    try {
      await during();
    } finally {
      tracker.current = measuring;
      wordAt.current = soundAt.current = performance.now();
      wantListening.current = true;
      try {
        r.start();
      } catch {
        /* already running */
      }
      setListening(true);
    }
  }, []);

  /** Closes the microphone at the end of the call. */
  const release = useCallback(() => {
    wantListening.current = false;
    rec.current?.abort();
    tracker.current = null;
    stopMeter();
  }, []);

  return { hold, release, supported, listening, speaking, finalText, interim, level, error, start, stop, speak, silence, setError, mouth, voiceKind, prefetch, quietFor, stream: () => stream.current };
}
