import { afterEach, describe, expect, it, vi } from "vitest";

describe("getDb", () => {
  afterEach(() => {
    vi.doUnmock("@electric-sql/pglite");
    vi.resetModules();
    delete (globalThis as { __db?: unknown }).__db;
  });

  it("retries after a failed start instead of caching the failure", async () => {
    process.env.PGLITE_DIR = "memory";
    let attempts = 0;
    vi.doMock("@electric-sql/pglite", async (orig) => {
      const real = (await orig()) as typeof import("@electric-sql/pglite");
      return {
        ...real,
        PGlite: class extends real.PGlite {
          constructor(...args: ConstructorParameters<typeof real.PGlite>) {
            attempts++;
            if (attempts === 1) throw new Error("database unreachable");
            super(...args);
          }
        },
      };
    });
    const { getDb } = await import("@/lib/db");
    await expect(getDb()).rejects.toThrow("database unreachable");
    const db = await getDb();
    expect(db).toBeTruthy();
    expect(attempts).toBe(2);
  }, 30_000);
});
