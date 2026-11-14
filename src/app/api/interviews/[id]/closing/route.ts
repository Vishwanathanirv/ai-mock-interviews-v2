import { NextResponse } from "next/server";
import { body, handle, HttpError, requireUser } from "@/lib/http";
import { ClosingInput } from "@/lib/validation";
import { closeInterview } from "@/lib/interview/service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const s = await requireUser();
  if (!rateLimit(`closing:${s.sub}`, 10, 60_000)) throw new HttpError(429, "Slow down a little and try again.");
  const { id } = await params;
  const { question } = await body(req, ClosingInput);
  return NextResponse.json({ closing: await closeInterview(s.sub, id, question ?? "") });
});
