import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findAudio, pcmToWav, synthesize, toWav } from "@/lib/interview/tts";

const pcm = new Uint8Array(4800).map((_, i) => i & 255);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });

describe("audio handling", () => {
  it("wraps PCM in a valid WAV header", () => {
    const wav = pcmToWav(pcm, 24000);
    const v = new DataView(wav.buffer);
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe("RIFF");
    expect(Buffer.from(wav.subarray(8, 12)).toString()).toBe("WAVE");
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(pcm.length);
  });

  it("finds audio in the Interactions response shape (WAV) and the generateContent shape (PCM)", () => {
    const wav = pcmToWav(pcm);
    const a = findAudio({ steps: [{ content: [{ type: "audio", mime_type: "audio/wav", data: b64(wav) }] }] })!;
    expect(toWav(a)).toEqual(wav);
    const b = findAudio({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: b64(pcm) } }] } }] })!;
    expect(new DataView(toWav(b).buffer).getUint32(24, true)).toBe(24000);
    expect(toWav(b).subarray(44)).toEqual(pcm);
  });

  it("returns null when there is no audio", () => {
    expect(findAudio({ candidates: [{ content: { parts: [{ text: "hello" }] } }] })).toBeNull();
  });
});

describe("synthesize", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("falls back to the next endpoint when one fails, and sends the key in a header, not the URL", async () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      if (calls.length === 1) return new Response("{}", { status: 404 });
      return ok({ steps: [{ content: [{ type: "audio", data: b64(pcmToWav(pcm)) }] }] });
    }) as unknown as typeof fetch;
    const wav = await synthesize("Tell me about yourself. (unique 1)", fake);
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe("RIFF");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).not.toContain("test-key");
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-key");
    expect(calls[0].body).toMatchObject({ response_format: { type: "audio" } });
  });

  it("caches repeated lines so the same question is not paid for twice", async () => {
    let n = 0;
    const fake = (async () => {
      n++;
      return ok({ steps: [{ content: [{ type: "audio", data: b64(pcmToWav(pcm)) }] }] });
    }) as unknown as typeof fetch;
    await synthesize("Repeat me (unique 2)", fake);
    await synthesize("Repeat me (unique 2)", fake);
    expect(n).toBe(1);
  });

  it("reports every failure when nothing works", async () => {
    const fake = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
    await expect(synthesize("Nothing works (unique 3)", fake)).rejects.toThrow(/HTTP 429/);
  });
});
