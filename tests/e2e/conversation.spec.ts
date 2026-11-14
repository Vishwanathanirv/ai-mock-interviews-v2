import { expect, test } from "@playwright/test";

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
  await page.addInitScript((answers: string[]) => {
    let turn = 0;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private timers: ReturnType<typeof setTimeout>[] = [];
      start() {
        const words = (answers[turn++] ?? "That's all.").split(" ");
        let said = "";
        words.forEach((w, i) => {
          this.timers.push(
            setTimeout(() => {
              said = said ? `${said} ${w}` : w;
              const last = i === words.length - 1;
              const result = Object.assign([{ transcript: last ? said : w }], { isFinal: last });
              this.onresult?.({ resultIndex: 0, results: [last ? result : Object.assign([{ transcript: said }], { isFinal: false })] });
            }, 300 + i * 90),
          );
        });
      }
      stop() {
        this.timers.forEach(clearTimeout);
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    // A silent microphone: the scripted words are the only "speech".
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      return ctx.createMediaStreamDestination().stream;
    };
  }, ANSWERS);

  await page.goto("/");
  await page.getByRole("button", { name: "Try it now, no sign-up" }).click();
  await page.getByRole("button", { name: /Backend Developer/ }).click();
  await page.getByRole("button", { name: "Junior" }).click();
  await page.getByLabel("Number of questions").fill("3");
  await page.getByRole("button", { name: "Start interview" }).click();
  await page.getByLabel("Read questions aloud").uncheck();
  await page.getByRole("button", { name: "Join interview" }).click();

  // Turn 1: the unprofessional answer ends by itself after the silence and is called out.
  await expect(page.getByText("Your turn: just talk")).toBeVisible();
  await expect(page.getByText(/lying down/)).toBeVisible();
  await expect(page.getByText(/Red flag: unprofessional setting/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Maya: .*(lying down|setting|game)/)).toBeVisible();

  // Turn 2: asking for a repeat repeats the question instead of grading the request.
  await expect(page.getByText(/Maya: Sure\./)).toBeVisible({ timeout: 15_000 });

  // The rest of the interview runs to the report with no clicks at all.
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  await expect(page.getByText("Interview report")).toBeVisible();
  await expect(page.getByText(/Red flag/).first()).toBeVisible();
});
