import { NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { finalizeReport, finishInterview } from "@/lib/interview/service";

export const runtime = "nodejs";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  await finishInterview(s.sub, id);
  return NextResponse.json({ report: await finalizeReport(s.sub, id) });
});
