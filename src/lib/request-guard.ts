/**
 * Request checks shared by every state-changing API route. Pure functions so they are unit tested.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID. Anything else can never be an interview id, so it is a 404, not a database error. */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Blocks cross-site requests that change state (login CSRF, forced sign-out, forged answers).
 * Browsers always send `Origin` on cross-origin POSTs, so a present Origin must match the host
 * the request was sent to. Requests without Origin (curl, server-to-server) carry no ambient
 * browser cookies from another site and are allowed.
 */
export function isSameOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || new URL(req.url).host;
  return originHost.toLowerCase() === host.toLowerCase();
}

/** JSON bodies must say they are JSON; a `text/plain` form post from another site is refused. */
export function isJson(req: Request): boolean {
  const type = req.headers.get("content-type") ?? "";
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(type.trim());
}
