import { expect, test } from "@playwright/test";

test("boots into the empty project shell", async ({ page }) => {
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");

  const application = page.getByRole("region", {
    name: "Rebase application",
  });
  const projects = page.getByRole("navigation", { name: "Projects" });

  await expect(application).toHaveCSS("height", "720px");
  await expect(application).toHaveCSS("width", "1280px");
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
  await expect(
    projects.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  await expect(
    projects.getByRole("heading", { level: 1, name: "Projects" }),
  ).toHaveCSS("font-size", "16px");
  await expect(
    projects.getByRole("button", { name: "Open project" }),
  ).toBeVisible();
  await expect(
    projects.getByRole("textbox", { name: "Filter open projects" }),
  ).toBeVisible();
  await expect(
    projects.getByRole("textbox", { name: "Filter open projects" }),
  ).toHaveCSS("font-size", "14px");
  await expect(projects.getByRole("status")).toHaveAttribute(
    "data-connection-state",
    "PairingRequired",
  );
  const projectList = projects.locator('[data-slot="project-list-scroll"]');
  await expect(projectList).toHaveCSS("overflow-x", "hidden");
  await expect(projectList).toHaveCSS("overflow-y", "auto");
  await expect(
    page.getByRole("main", { name: "Repository workspace" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("font-family", /Inter Variable/);
  expect(browserErrors).toEqual([]);
});

test("collapses and restores the project sidebar", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Collapse Projects sidebar" }).click();

  await expect(
    page.getByRole("button", { name: "Open project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Expand Projects sidebar" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
});

test("controls project navigation from the keyboard", async ({ page }) => {
  await page.goto("/");

  const filter = page.getByRole("textbox", { name: "Filter open projects" });
  await filter.fill("rebase");
  await expect(filter).toHaveValue("rebase");

  await page.keyboard.press("Control+b");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).not.toBeVisible();

  await page.keyboard.press("Control+b");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  await expect(filter).toHaveValue("rebase");
});
