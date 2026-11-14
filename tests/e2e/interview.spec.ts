import { expect, test, type Page } from "@playwright/test";

const GOOD =
  "When I was building my payment project, my task was to make checkout reliable. First I verified the webhook signature with an HMAC. Then I made the handler idempotent with an idempotency key and a unique constraint on the event id, so duplicates are ignored. I return 200 quickly and retry slow work in a background job. As a result we stopped double orders and errors fell by 40 percent.";

async function answerTyped(page: Page, text: string) {
  const box = page.getByLabel("Your answer");
  if (!(await box.isVisible())) await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByLabel("Your answer").fill(text);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Quick feedback")).toBeVisible();
}

test("guest can complete a full interview and see a report", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try it now, no sign-up" }).click();
  await expect(page).toHaveURL(/\/interview\/new/);

  await page.getByRole("button", { name: /Backend Developer/ }).click();
  await page.getByRole("button", { name: "Junior" }).click();
  await page.getByLabel("Number of questions").fill("3");
  await page.getByRole("button", { name: "Start interview" }).click();
  await expect(page).toHaveURL(/\/interview\/[0-9a-f-]{36}$/);

  await page.getByLabel("Read questions aloud").uncheck();
  await page.getByRole("button", { name: "Join interview" }).click();

  for (let i = 0; i < 3; i++) {
    await answerTyped(page, GOOD);
    const next = page.getByRole("button", { name: /Next question|Answer the follow-up|See my report/ });
    const label = await next.textContent();
    await next.click();
    if (label?.includes("See my report")) break;
  }

  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByText("Interview report")).toBeVisible();
  await expect(page.getByText("Answer by answer")).toBeVisible();
  await expect(page.getByRole("img", { name: /Overall score \d+ out of 100/ })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("Interviews completed")).toBeVisible();
  await expect(page.getByRole("link", { name: /Backend Developer/ })).toBeVisible();

  // The skill map estimates each topic from the answers, and offers a targeted session.
  await expect(page.getByRole("heading", { name: "Skill map" })).toBeVisible();
  await expect(page.getByRole("img", { name: /about \d+%, likely between \d+ and \d+/ }).first()).toBeVisible();
  const practise = page.getByRole("button", { name: "Practise my weak spots" });
  if (await practise.isVisible()) {
    await practise.click();
    await expect(page).toHaveURL(/\/interview\/[0-9a-f-]{36}$/);
  }
});

test("protected pages redirect to sign in, and accounts work end to end", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);

  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("8 characters");
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Hi Test")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("incorrect");
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("users cannot read each other's interviews", async ({ browser, request }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  await pa.goto("/");
  await pa.getByRole("button", { name: "Try it now, no sign-up" }).click();
  await expect(pa).toHaveURL(/\/interview\/new/);
  const res = await pa.request.post("/api/interviews", { data: { role: "security", level: "mid", focus: "technical", totalQuestions: 3 } });
  expect(res.status()).toBe(201);
  const { id } = await res.json();

  const other = await request.post("/api/auth/guest");
  expect(other.status()).toBe(201);
  const peek = await request.get(`/api/interviews/${id}`);
  expect(peek.status()).toBe(404);
  await a.close();
});

test("api validates input", async ({ request }) => {
  await request.post("/api/auth/guest");
  const bad = await request.post("/api/interviews", { data: { role: "chef", level: "junior", focus: "mixed", totalQuestions: 5 } });
  expect(bad.status()).toBe(400);
  const unauth = await (await (await import("@playwright/test")).request.newContext({ baseURL: test.info().project.use.baseURL })).get("/api/interviews");
  expect(unauth.status()).toBe(401);
});
