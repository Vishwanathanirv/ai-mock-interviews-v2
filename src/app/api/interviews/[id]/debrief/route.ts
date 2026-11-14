import { NextResponse } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { finalizeReport } from "@/lib/interview/service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** Finishes grading every answer and returns the interviewer's honest verdict, to be spoken. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  if (!rateLimit(`debrief:${s.sub}`, 10, 60_000)) throw new HttpError(429, "Slow down a little and try again.");
  const { id } = await params;
  const report = await finalizeReport(s.sub, id);
  return NextResponse.json({ debrief: report.summary, call: report.decision?.call ?? null });
});
