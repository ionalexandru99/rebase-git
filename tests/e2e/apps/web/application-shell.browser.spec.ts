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
  await expect(page.getByText("Web client ready.")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
