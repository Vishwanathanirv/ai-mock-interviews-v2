import { expect, test } from "@playwright/test";
import { fakeVoice, spoken } from "./fake-voice";

/**
 * The hands-free flow, end to end. Real speech recognition needs Google's servers, so the page
 * gets a scripted stand-in that "says" each answer word by word and then goes quiet, exactly as
 * the browser API would report it. Everything else (turn-taking, grading, the interviewer's
 * reaction, moving on, the report) is the real app.
 */
const ANSWERS = [
  "Actually I am lying down and attending the interview while my roommate is playing BGMI.",
  "Can you repeat the question?",
  "When I was building my payment project my task was to make checkout reliable. I made the webhook handler idempotent with a unique event id so duplicates are ignored, and as a result double orders stopped completely. That's it.",
  "I would add an index on the columns used in the where clause and check the query plan with explain to confirm the index is used.",
  "I would return 201 for a created resource, 404 when it is missing, and validate input with a schema. That's all.",
];

test("the interviewer listens, reacts honestly and moves on without any buttons", async ({ page }) => {
  await fakeVoice(page, ANSWERS);

  await page.goto("/");
  await page.getByRole("button", { name: "Try it now, no sign-up" }).click();
  await page.getByRole("button", { name: /Backend Developer/ }).click();
  await page.getByRole("button", { name: "Junior" }).click();
  await page.getByLabel("Number of questions").fill("3");
  await page.getByRole("button", { name: "Start interview" }).click();
  await page.getByRole("button", { name: "Join interview" }).click();

  // Turn 1: the unprofessional answer ends by itself after the silence and is called out.
  await expect(page.getByText("Your turn: just talk")).toBeVisible();
  await expect(page.getByText(/lying down/)).toBeVisible();
  await expect(page.getByText(/Red flag: unprofessional setting/)).toBeVisible({ timeout: 15_000 });

  // Turn 2: asking for a repeat repeats the question instead of grading the request.
  await expect.poll(async () => (await spoken(page)).some((l) => /^Sure\. /.test(l)), { timeout: 15_000 }).toBe(true);

  // The rest of the interview runs to the report with no clicks at all.
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  await expect(page.getByText("Interview report")).toBeVisible();
  await expect(page.getByText(/Red flag/).first()).toBeVisible();
  // Her spoken reaction is kept on the report, so it can be checked without racing the caption.
  await expect(page.getByText(/(lying down|setting).*(interview|job)/).first()).toBeVisible();
});
