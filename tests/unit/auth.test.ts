import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySession } from "@/lib/auth/token";
import { rateLimit } from "@/lib/rate-limit";

describe("passwords", () => {
  it("hashes with a unique salt and verifies", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips claims and rejects tampering", async () => {
    const t = await signSession({ sub: "u1", name: "Ann", guest: false });
    expect(await verifySession(t)).toEqual({ sub: "u1", name: "Ann", guest: false });
    expect(await verifySession(t.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
});

describe("rate limit", () => {
  it("blocks after the limit within the window and recovers after it", () => {
    const k = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 1000, 0)).toBe(true);
    expect(rateLimit(k, 3, 1000, 10)).toBe(false);
    expect(rateLimit(k, 3, 1000, 2000)).toBe(true);
  });
});
