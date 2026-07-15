import { expect, test } from "@playwright/test";

test("learner restores a hinted attempt and retries its failed architecture", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start scored attempt" }).click();

  await expect(page.getByText("Final score")).toBeVisible({ timeout: 10_000 });
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
