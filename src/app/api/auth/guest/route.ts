import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/http";
import { createGuest } from "@/lib/users";
import { startSession } from "@/lib/auth/session";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  if (!rateLimit(clientKey(req, "guest"), 10, 60_000)) throw new HttpError(429, "Too many attempts. Try again in a minute.");
  const user = await createGuest();
  await startSession({ sub: user.id, name: "Guest", guest: true });
  return NextResponse.json({ ok: true }, { status: 201 });
});
