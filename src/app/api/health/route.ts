import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiEnabled, aiStatus, probeAI } from "@/lib/interview/gemini";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether the app is configured and its database answers. Never prints a secret's value. */
export async function GET(req: Request) {
  // ?check=ai makes one real call to Gemini (rate-limited, so it cannot be used to burn quota).
  const probe = new URL(req.url).searchParams.get("check") === "ai" && aiEnabled() && rateLimit(clientKey(req, "health-ai"), 3, 60_000) ? await probeAI() : null;
  const secret = process.env.AUTH_SECRET;
  const config = {
    authSecret: !secret ? "missing" : secret.length < 32 ? "too short (needs 32+ characters)" : "ok",
    database: process.env.DATABASE_URL ? "postgres" : process.env.VERCEL ? "missing DATABASE_URL (using temporary storage)" : "pglite",
    ai: aiEnabled() ? "gemini" : "rules",
    ...(aiEnabled() ? { aiModel: aiStatus.model, aiLastError: aiStatus.lastError } : {}),
    ...(probe ? { aiCheck: probe.ok ? `ok (${probe.model})` : `failed: ${probe.error}` } : {}),
  };
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    const ok = config.authSecret === "ok" || process.env.NODE_ENV !== "production";
    return NextResponse.json({ ok, ...config, databaseReachable: true }, { status: ok ? 200 : 503 });
  } catch (err) {
    console.error("[health]", err);
    const code = (err as { code?: string }).code;
    return NextResponse.json({ ok: false, ...config, databaseReachable: false, ...(code ? { databaseError: code } : {}) }, { status: 503 });
  }
}
