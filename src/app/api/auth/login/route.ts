import { NextResponse } from "next/server";
import { body, handle, HttpError } from "@/lib/http";
import { LoginInput } from "@/lib/validation";
import { authenticate } from "@/lib/users";
import { startSession } from "@/lib/auth/session";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const { email, password } = await body(req, LoginInput);
  // Limit per IP and per account to slow down credential stuffing.
  if (!rateLimit(clientKey(req, "login"), 10, 60_000) || !rateLimit(`login:${email.toLowerCase()}`, 5, 60_000)) {
    throw new HttpError(429, "Too many attempts. Try again in a minute.");
  }
  const user = await authenticate(email, password);
  if (!user) throw new HttpError(401, "Email or password is incorrect.");
  await startSession({ sub: user.id, name: user.name, guest: false });
  return NextResponse.json({ ok: true });
});
