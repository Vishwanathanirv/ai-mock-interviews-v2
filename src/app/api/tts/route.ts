import { z } from "zod";
import { body, handle, HttpError, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { synthesize, ttsEnabled, TtsError } from "@/lib/interview/tts";

export const runtime = "nodejs";
export const maxDuration = 30;

const Input = z.object({ text: z.string().trim().min(1).max(600) });

/** The interviewer's natural voice. 503 tells the client to use the browser voice instead. */
export const POST = handle(async (req: Request) => {
  const s = await requireUser();
  if (!ttsEnabled()) throw new HttpError(503, "Natural voice is not configured.");
  if (!rateLimit(`tts:${s.sub}`, 80, 60 * 60_000)) throw new HttpError(429, "Voice limit reached for this hour; using the browser voice.");
  const { text } = await body(req, Input);
  try {
    const wav = await synthesize(text);
    return new Response(wav as Uint8Array<ArrayBuffer>, { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600" } });
  } catch (e) {
    if (e instanceof TtsError) {
      console.warn("[tts] falling back to the browser voice:", e.message);
      throw new HttpError(503, "Natural voice is unavailable right now.");
    }
    throw e;
  }
});
