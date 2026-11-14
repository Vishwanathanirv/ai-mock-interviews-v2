import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// OWASP-recommended scrypt cost (N=2^15, r=8, p=1).
const N = 32768;
const KEYLEN = 64;
const OPTS = { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Hashes a password as `scrypt$N$salt$hash` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, OPTS);
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Constant-time verification against a stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
    ...OPTS,
    N: Number(n),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
