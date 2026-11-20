import { expect, test } from "@playwright/test";

test("how it works grades one answer through every stage of the real grader", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#how-it-works$/);
  const how = page.locator("#how-it-works");
  const stage = (n: number) => how.getByRole("list", { name: "Stages" }).getByRole("button").nth(n);

  // A strong technical answer covers every idea and scores well, with no follow-up.
  await stage(1).click();
  await expect(how.getByText("✓ status codes")).toBeVisible();
  await stage(5).click();
  await expect(how.getByText("No follow-up: he moves to the next question.")).toBeVisible();

  // A thin one misses ideas, so Arjun digs into the first missing one.
  await how.getByRole("button", { name: "Thin" }).click();
  await expect(how.getByText(/“How would you handle .+\?”/)).toBeVisible();

  // Conduct comes first: an unprofessional answer is flagged and every score is capped.
  await how.getByRole("radio", { name: "A behavioural question" }).click();
  await how.getByRole("button", { name: "Too relaxed" }).click();
  await stage(0).click();
  await expect(how.getByText(/Flagged: .*unprofessional setting/)).toBeVisible();
});
