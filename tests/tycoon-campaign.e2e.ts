import { expect, test, type Page } from "@playwright/test";

const progressKey = "scalelab:tycoon-progress";
const campaignRoutes = [
  ["opening-day", "Opening Day"],
  ["first-spike", "The First Spike"],
  ["viral-link", "The Viral Link"],
  ["cascading-trouble", "Cascading Trouble"],
  ["global-launch", "Global Launch"],
] as const;

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

test("every game route remains reachable and malformed routes recover safely", async ({ page }) => {
  await page.addInitScript(
    ({ key, completedChapterIds }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          completedChapterIds,
          encounteredConcepts: [],
          claimedRewardChapterIds: completedChapterIds,
        }),
      );
    },
    { key: progressKey, completedChapterIds: campaignRoutes.map(([id]) => id) },
  );

  for (const [id, heading] of campaignRoutes) {
    await page.goto(`/game/${id}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByLabel("Build infrastructure")).toBeVisible();
  }

  await page.goto("/game/not-a-mission");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: /Grow the crowd/ })).toBeVisible();

  await page.goto("/not-a-route");
  await expect(page.getByRole("heading", { name: "That route is outside the park." })).toBeVisible();
});

test("the standalone dropdown primitive supports building actions", async ({ page }) => {
  await page.goto("/game/sandbox");
  await page.getByRole("button", { name: /^API server, .* replicas$/ }).click();
  await page.getByRole("button", { name: "Actions" }).click();

  await expect(page.getByRole("menuitem", { name: "Add traffic route" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Remove component" })).toBeVisible();
});
