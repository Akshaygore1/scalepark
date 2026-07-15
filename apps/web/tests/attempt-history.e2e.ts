import { expect, test } from "@playwright/test";

test("learner restores a hinted attempt and retries its failed architecture", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /API server ×/ }).click();
  await page.getByLabel("Capacity / sec").fill("3200");
  await page.getByRole("button", { name: "Start learning mode" }).click();
  await expect(page.getByText(/running · \d{2}:00/)).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Inject database slowdown" }).click();
  await expect(page.getByRole("button", { name: /Primary database.*heating/i })).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Start scored attempt" }).click();

  await expect(page.getByText("Final score")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Replay second")).toBeVisible();
  await page.getByRole("button", { name: "Reveal symptom hint · −25" }).click();
  await expect(page.getByText("Symptom · −25")).toBeVisible();
  await expect(page.getByText("1 saved locally")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Symptom · −25")).toBeVisible();
  await expect(page.getByText("1 saved locally")).toBeVisible();

  await page.getByRole("button", { name: "Retry from failed architecture" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Failed architecture restored. Make a bounded change",
  );

  await page.getByRole("button", { name: "Start scored attempt" }).click();
  await expect(page.getByText("2 saved locally")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Hints requested").locator("..")).toContainText("−25");
});
