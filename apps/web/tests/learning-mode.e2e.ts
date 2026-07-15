import { expect, test } from "@playwright/test";

test("learner edits, runs, pauses, injects an incident, and resumes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build a request path" })).toBeVisible();

  await page.getByRole("button", { name: /API server ×/ }).click();
  await page.getByLabel("Capacity / sec").fill("3200");
  await expect(page.getByLabel("Capacity / sec")).toHaveValue("3200");

  await page.getByRole("button", { name: "Start learning mode" }).click();
  await expect(page.getByText(/running · \d{2}:00/)).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText(/paused · \d{2}:00/)).toBeVisible();

  await page.getByLabel("Capacity / sec").fill("6400");
  await expect(page.getByText(/pending until \d{2}:00 · runtime-edit/)).toBeVisible();

  await page.getByRole("button", { name: "Inject database slowdown" }).click();
  await expect(page.getByRole("button", { name: /Primary database.*heating/i })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText(/running · \d{2}:00/)).toBeVisible();
  await expect(page.getByText(/running · 0[1-9]:00/)).toBeVisible();
  await expect(
    page.getByLabel("Learning mode controls").getByText(/Availability 100\.00%/),
  ).toBeVisible();
});
