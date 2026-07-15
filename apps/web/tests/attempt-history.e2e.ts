import { expect, test } from "@playwright/test";

test("sandbox exposes every building and deploys construction during live traffic", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter sandbox" }).click();
  await expect(page.getByRole("heading", { name: "Sandbox Park" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cache $4,500" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue $3,000" })).toBeVisible();
  await page.getByRole("button", { name: "Cache $4,500" }).click();
  await expect(page.getByText(/Cache kiosk will open in 4 simulated seconds/)).toBeVisible();
  await page.getByRole("button", { name: "4×" }).click();
  await page.getByRole("button", { name: "Start park" }).click();
  await expect(page.getByRole("button", { name: /Cache kiosk, healthy/ })).toBeVisible({
    timeout: 5_000,
  });
});
