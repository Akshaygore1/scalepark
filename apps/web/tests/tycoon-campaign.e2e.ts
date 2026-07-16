import { expect, test, type Page } from "@playwright/test";

const progressKey = "scalelab:tycoon-progress";

async function resetProgress(page: Page) {
  await page.goto("/");
  await page.evaluate((key) => window.localStorage.removeItem(key), progressKey);
  await page.reload();
}

test("a fresh mission deep link boots as a client-rendered tycoon", async ({ page }) => {
  await resetProgress(page);
  await page.goto("/game/opening-day");

  await expect(page.getByRole("heading", { name: "Opening Day" })).toBeVisible();
  await expect(page.getByText("Loading park…")).toHaveCount(0);
  await expect(page.getByText("Mission reward")).toBeVisible();
  await expect(page.getByLabel("Build infrastructure")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start park" })).toBeVisible();
});

test("completing a mission carries its park, economy, and reward forward", async ({ page }) => {
  await resetProgress(page);
  await page.goto("/game/opening-day");

  await page.getByRole("button", { name: "API server, healthy, 1 replicas" }).click();
  await page.getByRole("button", { name: "Increase desired replicas" }).click();
  await page.getByRole("button", { name: "Deploy 1 replica $1,800" }).click();
  await expect(page.getByRole("button", { name: "API server, healthy, 2 replicas" })).toBeVisible();

  await page.getByRole("button", { name: "Primary database, healthy, 1 replicas" }).click();
  await page.getByRole("button", { name: "Increase desired replicas" }).click();
  await page.getByRole("button", { name: "Deploy 1 replica $1,800" }).click();
  await expect(
    page.getByRole("button", { name: "Primary database, healthy, 2 replicas" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "4×" }).click();
  await page.getByRole("button", { name: "Start park" }).click();
  await page.getByRole("button", { name: "Review park while paused" }).click();
  await page.getByRole("button", { name: "Start park" }).click();

  await expect(page.getByRole("heading", { name: "The crowd made it through." })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/\$12K has been added for the next mission/)).toBeVisible();
  await page.getByRole("button", { name: "Continue with this park" }).click();

  await expect(page.getByRole("heading", { name: "The First Spike" })).toBeVisible();
  await expect(page.getByRole("button", { name: "API server, healthy, 2 replicas" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Primary database, healthy, 2 replicas" }),
  ).toBeVisible();
  const progress = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
    progressKey,
  );
  expect(progress.completedChapterIds).toContain("opening-day");
  expect(progress.claimedRewardChapterIds).toContain("opening-day");
  expect(progress.campaignPark.cash).toBeGreaterThan(26_000);
});

test("locked missions redirect to the map and Sandbox stays unrestricted", async ({ page }) => {
  await resetProgress(page);
  await page.goto("/game/viral-link");
  await expect(page).toHaveURL("/");

  await page.goto("/game/sandbox");
  await expect(page.getByRole("heading", { name: "Sandbox Park" })).toBeVisible();
  await expect(page.getByLabel("Build infrastructure")).toBeVisible();
  await expect(page.getByText("$250K", { exact: true })).toBeVisible();
});
