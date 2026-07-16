import { expect, test } from "@playwright/test";

test("campaign selection navigates to a level route and browser back returns to the menu", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the park" }).click();

  await expect(page).toHaveURL(/\/game\/opening-day$/);
  await expect(page.getByRole("heading", { name: "Opening Day" })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Grow the crowd. Keep the links alive." }),
  ).toBeVisible();
});

test("direct game routes enforce progress while keeping sandbox available", async ({ page }) => {
  await page.addInitScript(() => {
    const seenHeadings: string[] = [];
    Object.assign(window, { __scalelabSeenHeadings: seenHeadings });
    new MutationObserver(() => {
      for (const heading of document.querySelectorAll("h1")) {
        const text = heading.textContent?.trim();
        if (text && !seenHeadings.includes(text)) seenHeadings.push(text);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/game/first-spike");
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __scalelabSeenHeadings: string[] }).__scalelabSeenHeadings,
    ),
  ).not.toContain("The First Spike");

  await page.goto("/game/sandbox");
  await expect(page.getByRole("heading", { name: "Sandbox Park" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start park" })).toBeVisible();
  await expect(page.locator(".hud-clock").getByText("00:00", { exact: true })).toBeVisible();

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "scalelab:tycoon-progress",
      JSON.stringify({
        version: 1,
        completedChapterIds: ["opening-day"],
        encounteredConcepts: [],
      }),
    );
  });
  await page.goto("/game/first-spike");
  await expect(page.getByRole("heading", { name: "The First Spike" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start park" })).toBeVisible();
});

test("the game HUD returns to the campaign menu", async ({ page }) => {
  await page.goto("/game/opening-day");
  await page.getByRole("button", { name: "ScaleLab Park" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Grow the crowd. Keep the links alive." }),
  ).toBeVisible();
});

test("unknown game levels use the application 404 boundary", async ({ page }) => {
  await page.goto("/game/not-a-level");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByText("The requested page could not be found.")).toBeVisible();
});
