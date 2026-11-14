import "server-only";

/**
 * The interviewer's voice, synthesised with Gemini text-to-speech.
 *
 * Google has two ways to ask for speech: the Interactions API (current models such as
 * gemini-3.8-flash-tts) and generateContent with an AUDIO response (older preview models).
 * This tries them in order and accepts the audio however it comes back (a WAV file, or raw
 * 16-bit PCM that we wrap in a WAV header), so a change on Google's side degrades to the next
 * option instead of breaking. If everything fails, the caller falls back to the browser voice.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

export const ttsEnabled = () => Boolean(process.env.GEMINI_API_KEY) && process.env.GEMINI_TTS !== "off";

const VOICE = () => process.env.GEMINI_TTS_VOICE || "Achird";
const STYLE = "a warm, professional job interviewer speaking naturally at a relaxed conversational pace";

type Attempt = { api: "interactions" | "generateContent"; model: string };

function attempts(): Attempt[] {
  const custom = process.env.GEMINI_TTS_MODEL;
  const list: Attempt[] = [
    ...(custom ? [{ api: "interactions" as const, model: custom }, { api: "generateContent" as const, model: custom }] : []),
    { api: "interactions", model: "gemini-3.8-flash-tts" },
    { api: "interactions", model: "gemini-3.1-flash-tts-preview" },
    { api: "generateContent", model: "gemini-2.5-flash-preview-tts" },
  ];
  return list;
}

/** Wraps mono 16-bit little-endian PCM in a WAV (RIFF) header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

const isWav = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";

/** Finds base64 audio anywhere in a response: `data` next to an audio mime type, or in `inlineData`. */
export function findAudio(json: unknown): { data: string; mime: string } | null {
  let found: { data: string; mime: string } | null = null;
  const visit = (x: unknown, depth: number) => {
    if (found || depth > 12 || !x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach((y) => visit(y, depth + 1));
    const o = x as Record<string, unknown>;
    const mime = String(o.mime_type ?? o.mimeType ?? "");
    if (typeof o.data === "string" && o.data.length > 100 && (mime.startsWith("audio") || o.type === "audio" || !mime)) {
      found = { data: o.data, mime: mime || "audio/wav" };
      return;
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };
  visit(json, 0);
  return found;
}

/** Turns a found audio payload into WAV bytes (PCM rate read from the mime type when present). */
export function toWav(audio: { data: string; mime: string }): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(audio.data, "base64"));
  if (isWav(bytes)) return bytes;
  const rate = Number(/rate=(\d+)/.exec(audio.mime)?.[1] ?? 24000);
  return pcmToWav(bytes, rate);
}

function request(a: Attempt, text: string): { url: string; body: unknown } {
  if (a.api === "interactions") {
    return {
      url: `${API}/interactions`,
      body: {
        model: a.model,
        input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: VOICE() }] },
      },
    };
  }
  return {
    url: `${API}/models/${a.model}:generateContent`,
    body: {
      contents: [{ parts: [{ text: `Say this as ${STYLE}: ${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE() } } } },
    },
  };
}

const cache = new Map<string, Uint8Array>();
let preferred = 0; // index of the attempt that last worked, tried first next time

export class TtsError extends Error {}

export async function synthesize(text: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const key = `${VOICE()}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const list = attempts();
  const order = [list[preferred] ?? list[0], ...list.filter((_, i) => i !== preferred)];
  const errors: string[] = [];
  for (const a of order) {
    const { url, body } = request(a, text);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetchImpl(url, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! }, body: JSON.stringify(body) });
      if (!res.ok) {
        errors.push(`${a.api}/${a.model}: HTTP ${res.status}`);
        continue;
      }
      const audio = findAudio(await res.json());
      if (!audio) {
        errors.push(`${a.api}/${a.model}: no audio in response`);
        continue;
      }
      const wav = toWav(audio);
      preferred = list.findIndex((x) => x.api === a.api && x.model === a.model);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      cache.set(key, wav);
      return wav;
    } catch (e) {
      errors.push(`${a.api}/${a.model}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new TtsError(errors.join("; "));
}
