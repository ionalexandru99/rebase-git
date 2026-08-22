import { expect, test } from "@playwright/test";

test("boots the web application into its technical shell", async ({ page }) => {
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Rebase" }),
  ).toBeVisible();
  await expect(page.getByText("Pairing required")).toBeVisible();
  await expect(
    page.getByText("Open the pairing URL printed by the local Rebase process."),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});
