import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, expect, test } from "@playwright/test";
import type { VoiceMetrics } from "../../src/lib/voice/prosody";

/** A voice-like WAV: harmonic series following an intonation contour, with silent gaps. */
function wav(seconds: number, semitoneSwing: number, silent: (t: number) => boolean) {
  const rate = 16000;
  const n = rate * seconds;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * 130 * 2 ** ((semitoneSwing * Math.sin(2 * Math.PI * 0.6 * t)) / 12)) / rate;
    let v = 0;
    if (!silent(t)) for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
    pcm.writeInt16LE(Math.round(v * 0.2 * 32767), 44 + i * 2);
  }
  return pcm;
}

test.describe("voice analytics in the browser", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "fake microphone input is Chromium-only");

  test("measures pitch variety and pauses from a live microphone stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-e2e-"));
    await build({ entryPoints: [join(__dirname, "voice/harness.ts")], bundle: true, format: "iife", outfile: join(dir, "bundle.js"), logLevel: "silent" });
    writeFileSync(join(dir, "index.html"), '<!doctype html><script src="bundle.js"></script>');
    const server = createServer((req, res) => {
      const file = req.url === "/bundle.js" ? "bundle.js" : "index.html";
      res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
      res.end(readFileSync(join(dir, file)));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const cases = [
      { name: "lively", file: wav(9, 4, (t) => t < 0.8 || (t > 4 && t < 6.2)), expect: (m: VoiceMetrics) => expect(m.monotone).toBe(false) },
      { name: "flat", file: wav(9, 0.3, (t) => t < 0.8), expect: (m: VoiceMetrics) => expect(m.monotone).toBe(true) },
    ];
    try {
      for (const c of cases) {
        const path = join(dir, `${c.name}.wav`);
        writeFileSync(path, c.file);
        const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path}`, "--autoplay-policy=no-user-gesture-required"] });
        const page = await browser.newPage();
        await page.goto(`http://localhost:${port}/`);
        const r = (await page.evaluate((ms) => (window as unknown as { measure: (ms: number) => Promise<unknown> }).measure(ms), 8500)) as { blocks: number; sampleRate: number; summary: VoiceMetrics };
        await browser.close();
        // Every sample arrives: 8.5 s of blocks of 2048, give or take start-up.
        expect(r.blocks * 2048).toBeGreaterThan(r.sampleRate * 7.5);
        expect(r.summary.speakingSec).toBeGreaterThan(5);
        expect(r.summary.pitchMedianHz).toBeGreaterThan(115);
        expect(r.summary.pitchMedianHz).toBeLessThan(145);
        c.expect(r.summary);
        if (c.name === "lively") {
          expect(r.summary.pauses).toBe(1);
          expect(r.summary.longestPauseSec).toBeGreaterThan(1.8);
          expect(r.summary.longestPauseSec).toBeLessThan(2.6);
        }
      }
    } finally {
      server.close();
    }
  });
});
