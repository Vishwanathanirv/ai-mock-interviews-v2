import { NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { finishInterview } from "@/lib/interview/service";

export const runtime = "nodejs";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  return NextResponse.json({ report: await finishInterview(s.sub, id) });
});
