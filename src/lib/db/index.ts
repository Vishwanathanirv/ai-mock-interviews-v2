import "server-only";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzleLite<typeof schema>>;

const g = globalThis as unknown as { __db?: Promise<Db> };

/**
 * Returns a ready database. Uses Postgres when DATABASE_URL is set (production),
 * otherwise an embedded Postgres (PGlite) stored in ./.data so the app runs with zero setup.
 */
export function getDb(): Promise<Db> {
  if (!g.__db) g.__db = init();
  return g.__db;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { max: 5, prepare: false });
    await client.unsafe(schema.BOOTSTRAP_SQL);
    return drizzlePg(client, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? "/tmp/pglite" : "./.data/pglite");
  if (dir !== "memory") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  await client.exec(schema.BOOTSTRAP_SQL);
  return drizzleLite(client, { schema });
}

export { schema };
