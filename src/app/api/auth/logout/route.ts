import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";
import { handle } from "@/lib/http";

// The request is taken so handle() can refuse cross-site sign-outs.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const POST = handle(async (_req: Request) => {
  await endSession();
  return NextResponse.json({ ok: true });
});
