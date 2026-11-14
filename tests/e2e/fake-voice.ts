import type { Page } from "@playwright/test";

/**
 * Real speech recognition needs Google's servers, so the page gets a scripted stand-in that
 * "says" each answer word by word and then goes quiet, exactly as the browser API would report
 * it. The interviewer's voice finishes instantly. Everything else is the real app.
 */
export async function fakeVoice(page: Page, answers: string[]) {
  await page.route("/api/tts", (r) => r.fulfill({ status: 503, body: "{}" }));
  await page.addInitScript((answers: string[]) => {
    let turn = 0;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private timers: ReturnType<typeof setTimeout>[] = [];
      start() {
        const words = (answers[turn++] ?? "That's all.").split(" ");
        let said = "";
        words.forEach((w, i) => {
          this.timers.push(
            setTimeout(() => {
              said = said ? `${said} ${w}` : w;
              const last = i === words.length - 1;
              const result = Object.assign([{ transcript: last ? said : w }], { isFinal: last });
              this.onresult?.({ resultIndex: 0, results: [last ? result : Object.assign([{ transcript: said }], { isFinal: false })] });
            }, 300 + i * 90),
          );
        });
      }
      stop() {
        this.timers.forEach(clearTimeout);
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    // A real-sounding room: steady fan-like hum plus noise whose loudness keeps changing, so the
    // microphone level moves all the time the way it does on a real laptop.
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const out = ctx.createMediaStreamDestination();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.03 + Math.sin(i / 40) * 0.01;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.7;
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 3;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      wobble.connect(depth).connect(gain.gain);
      noise.connect(gain).connect(out);
      noise.start();
      wobble.start();
      return out.stream;
    };
    // The interviewer's voice: finish each line almost at once, so tests don't wait for real speech.
    const said: string[] = ((window as unknown as { __said: string[] }).__said = []);
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
      said.push(u.text);
      setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 30);
    };
  }, answers);
}

/** Everything the interviewer has said so far, in order. */
export const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
