import { NextResponse } from "next/server";
import { body, handle, HttpError, requireUser } from "@/lib/http";
import { NewInterviewInput } from "@/lib/validation";
import { createInterview, listInterviews } from "@/lib/interview/service";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const s = await requireUser();
  const rows = await listInterviews(s.sub);
  return NextResponse.json({
    interviews: rows.map((r) => ({ id: r.id, role: r.role, level: r.level, focus: r.focus, status: r.status, overallScore: r.overallScore, createdAt: r.createdAt })),
  });
});

export const POST = handle(async (req: Request) => {
  const s = await requireUser();
  if (!rateLimit(`create:${s.sub}`, 10, 60 * 60_000)) throw new HttpError(429, "You've started a lot of interviews this hour. Take a break and try again soon.");
  const cfg = await body(req, NewInterviewInput);
  const row = await createInterview(s.sub, cfg);
  return NextResponse.json({ id: row.id, question: row.currentQuestion, provider: row.provider }, { status: 201 });
});
