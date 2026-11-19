# Changelog

All notable changes to this project. Dates are UTC.

## 2026-11-19

### Security
- State-changing API routes refuse cross-site requests (Origin must match the host) and JSON bodies must be sent as `application/json`, closing login CSRF via a cross-site `text/plain` form post.
- Content-Security-Policy (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) and Cross-Origin-Opener-Policy headers. Checked in Chromium that face tracking, the microphone worklet and voice still work under the policy.
- Unexpected server errors log only the error type and message, not database query parameters.
- Dependencies: drizzle-orm 0.45 (SQL identifier escaping), zod 4 (memory exhaustion), vitest 5 (tinypool RCE), postcss 8.5 inside Next.js. `npm audit`: 17 findings (2 critical, 3 high) down to 4 moderate in dev tooling only; 0 in production dependencies.

### Fixed
- An interview id that is not a UUID now returns 404 instead of a 500 database error.
- A failed database start is no longer cached; the next request retries instead of every request failing until a restart.

### Changed
- The dashboard is now the notebook's **practice log**: scores plotted against each interview's hiring bar, the skill map as measurements with error whiskers, and sessions as ruled entries. Sign-in, sign-up, setup, report and 404 pages share the same graph paper.
- The report shows delivery as readings on rulers with the target band marked, and its notes as ticks, pencil marks and a study checklist instead of three cards.
- CI audits production dependencies, runs with a read-only token, and cancels superseded runs.
