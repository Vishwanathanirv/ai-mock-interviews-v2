import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession, verifySession, type SessionClaims } from "./token";

export async function getSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export async function startSession(claims: SessionClaims): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(claims), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
