import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "rh_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

export type SessionClaims = { sub: string; name: string; guest: boolean };

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set (32+ characters) in production.");
  }
  return new TextEncoder().encode("dev-only-secret-change-me-dev-only-secret");
}

/** Edge-safe: used by both route handlers and middleware. */
export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ name: claims.name, guest: claims.guest })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, name: String(payload.name ?? ""), guest: Boolean(payload.guest) };
  } catch {
    return null;
  }
}
