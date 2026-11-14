import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSession } from "@/lib/auth/session";
import { ConflictError, NotFoundError } from "@/lib/interview/service";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser() {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Please sign in.");
  return s;
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
  return schema.parse(raw);
}

/** Wraps a route handler with consistent JSON errors and no stack traces leaking to clients. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid input." }, { status: 400 });
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
      if (err instanceof ConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
      console.error(err);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
