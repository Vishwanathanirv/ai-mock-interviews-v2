import { expect, test } from "@playwright/test";

test("cross-site and malformed API requests are refused cleanly", async ({ request, baseURL }) => {
  // Login CSRF: a form on another site posting text/plain JSON must not start a session.
  const forged = await request.post("/api/auth/guest", { headers: { origin: "https://evil.example" } });
  expect(forged.status()).toBe(403);
  expect(forged.headers()["set-cookie"]).toBeUndefined();

  const textPlain = await request.post("/api/auth/signup", {
    headers: { "content-type": "text/plain", origin: new URL(baseURL!).origin },
    data: JSON.stringify({ name: "X", email: "csrf@example.com", password: "12345678" }),
  });
  expect(textPlain.status()).toBe(415);

  expect((await request.post("/api/auth/guest")).status()).toBe(201);
  // An id that is not a UUID is simply not found, not a server error.
  const bogus = await request.get("/api/interviews/not-a-uuid");
  expect(bogus.status()).toBe(404);
});

test("pages are served with a content security policy", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
});
