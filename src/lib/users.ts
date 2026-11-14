import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export async function createUser(email: string, name: string, password: string) {
  const db = await getDb();
  const passwordHash = await hashPassword(password);
  try {
    const [u] = await db.insert(schema.users).values({ email: email.toLowerCase(), name, passwordHash }).returning();
    return u;
  } catch {
    return null; // unique violation: email taken
  }
}

// Pre-computed hash so unknown emails take as long as wrong passwords (no user enumeration by timing).
let dummyHash: Promise<string> | undefined;

export async function authenticate(email: string, password: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
  if (!u?.passwordHash) {
    dummyHash ??= hashPassword("timing-equaliser");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, u.passwordHash)) ? u : null;
}

export async function createGuest() {
  const db = await getDb();
  const [u] = await db
    .insert(schema.users)
    .values({ email: `guest-${randomUUID()}@guest.local`, name: "Guest", isGuest: 1 })
    .returning();
  return u;
}

export async function getUser(id: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return u ?? null;
}
