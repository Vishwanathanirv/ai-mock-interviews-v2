import { NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { deleteInterview, getInterview } from "@/lib/interview/service";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  const { interview, turns } = await getInterview(s.sub, id);
  return NextResponse.json({ interview, turns });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const s = await requireUser();
  const { id } = await params;
  await deleteInterview(s.sub, id);
  return new NextResponse(null, { status: 204 });
});
