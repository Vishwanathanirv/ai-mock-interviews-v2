import { NextResponse } from "next/server";
import { body, handle, HttpError, requireUser } from "@/lib/http";
import { AnswerInput } from "@/lib/validation";
import { submitAnswer } from "@/lib/interview/service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const s = await requireUser();
  if (!rateLimit(`answer:${s.sub}`, 30, 60_000)) throw new HttpError(429, "Slow down a little and try again.");
  const { id } = await params;
  const { answer, durationSec, voice, video } = await body(req, AnswerInput);
  return NextResponse.json(await submitAnswer(s.sub, id, answer, durationSec, voice, video));
});
