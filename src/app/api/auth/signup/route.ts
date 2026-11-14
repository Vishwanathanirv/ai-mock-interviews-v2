import { NextResponse } from "next/server";
import { body, handle, HttpError } from "@/lib/http";
import { SignupInput } from "@/lib/validation";
import { createUser } from "@/lib/users";
import { startSession } from "@/lib/auth/session";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  if (!rateLimit(clientKey(req, "signup"), 5, 60_000)) throw new HttpError(429, "Too many attempts. Try again in a minute.");
  const { name, email, password } = await body(req, SignupInput);
  const user = await createUser(email, name, password);
  if (!user) throw new HttpError(409, "An account with this email already exists.");
  await startSession({ sub: user.id, name: user.name, guest: false });
  return NextResponse.json({ ok: true }, { status: 201 });
});
