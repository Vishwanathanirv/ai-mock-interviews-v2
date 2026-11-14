// Browser harness for the voice e2e test: the same wiring as useVoice
// (getUserMedia → AudioWorklet capture → ProsodyTracker), without the speech-recognition service.
import { CAPTURE_WORKLET } from "../../../src/lib/voice/capture";
import { ProsodyTracker } from "../../../src/lib/voice/prosody";

(window as unknown as { measure: (ms: number) => Promise<unknown> }).measure = async (ms: number) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, "mv-capture");
  const tracker = new ProsodyTracker(ctx.sampleRate);
  let blocks = 0;
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    blocks++;
    tracker.push(e.data);
  };
  ctx.createMediaStreamSource(stream).connect(node);
  await new Promise((r) => setTimeout(r, ms));
  stream.getTracks().forEach((t) => t.stop());
  const sampleRate = ctx.sampleRate;
  await ctx.close();
  return { sampleRate, blocks, summary: tracker.summary() };
};
