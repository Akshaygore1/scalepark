import { expect, test } from "@playwright/test";

test("founder opens the park, watches traffic grow, and receives a causal lesson", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Grow the crowd. Keep the links alive." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open the park" }).click();
  await expect(page.getByRole("heading", { name: "Opening Day" })).toBeVisible();
  await page.getByRole("button", { name: "4×" }).click();
  await page.getByRole("button", { name: "Start park" }).click();
  await expect(page.getByRole("heading", { name: "A line is forming" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByText("Requests arrived faster than one building could finish them."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Got it — show me the park" }).click();
  await expect(page.getByRole("button", { name: "Start park" })).toBeVisible();
  await page.getByRole("button", { name: "Open system design journal" }).click();
  await expect(page.getByRole("heading", { name: "System design journal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A line is forming" })).toBeVisible();
});
