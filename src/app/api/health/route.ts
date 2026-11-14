import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiEnabled } from "@/lib/interview/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: process.env.DATABASE_URL ? "postgres" : "pglite", ai: aiEnabled() ? "gemini" : "rules" });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
