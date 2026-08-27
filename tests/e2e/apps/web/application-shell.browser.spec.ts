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
  const openProject = page.getByRole("main", { name: "Open project" });
  await expect(openProject).toBeVisible();
  await expect(
    openProject.getByRole("heading", { level: 1, name: "Open project" }),
  ).toBeVisible();
  await expect(
    openProject.getByRole("searchbox", { name: "Search repositories" }),
  ).toBeFocused();
  await expect(
    openProject.getByRole("button", { name: "Browse files" }),
  ).toBeDisabled();
  await expect(
    openProject.getByRole("button", {
      name: /Open a repository from your file system/,
    }),
  ).toBeDisabled();
  await expect(openProject.getByText("Recent", { exact: true })).toHaveCount(0);
  await expect(projects).toHaveCSS("border-right-width", "1px");
  await expect(openProject).toHaveCSS("border-top-left-radius", "0px");
  await expect(page.locator("html")).toHaveCSS("font-family", /Inter Variable/);
  expect(browserErrors).toEqual([]);
});

test("opens the project launcher from both sidebar modes", async ({ page }) => {
  await page.goto("/");

  const search = page.getByRole("searchbox", { name: "Search repositories" });
  const projectFilter = page.getByRole("textbox", {
    name: "Filter open projects",
  });
  await projectFilter.focus();
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(search).toBeFocused();

  await page.getByRole("button", { name: "Collapse Projects sidebar" }).click();
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(search).toBeFocused();
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

  await page.keyboard.press("Control+Shift+f");
  await expect(filter).toBeFocused();

  await page.keyboard.press("Control+Shift+o");
  await expect(
    page.getByRole("searchbox", { name: "Search repositories" }),
  ).toBeFocused();
});

test("opens and navigates settings", async ({ page }) => {
  await page.goto("/");

  const projectFilter = page.getByRole("textbox", {
    name: "Filter open projects",
  });
  await projectFilter.fill("rebase");
  await page.getByRole("button", { name: "Settings" }).click();

  const settings = page.getByRole("navigation", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings).toHaveCSS("border-right-width", "1px");
  await expect(page.getByRole("main", { name: "Settings content" })).toHaveCSS(
    "border-top-left-radius",
    "0px",
  );
  await expect(
    settings.getByRole("button", { name: "General", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: "Git" })).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Appearance" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "General" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "About" }),
  ).toBeVisible();
  await expect(page.getByText("Source code")).toHaveCount(0);
  await expect(page.getByText("License", { exact: true })).toHaveCount(0);
  const releaseChannel = page.getByRole("combobox", {
    name: "Release channel",
  });
  await expect(releaseChannel).toHaveText("Stable");
  await expect(releaseChannel).toBeDisabled();
  await expect(
    page.getByRole("switch", { name: "Check automatically" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Check for updates" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Update now" })).toBeDisabled();
  await expect(
    page.getByText("Update checks are available in the Electron app."),
  ).toBeVisible();

  const search = settings.getByRole("textbox", { name: "Search settings" });
  await search.fill("keyboard");
  await expect(
    settings.getByRole("button", { name: "General", exact: true }),
  ).toHaveCount(0);
  await search.clear();

  await settings.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await expect(releaseChannel).toHaveText("Stable");

  await page.setViewportSize({ height: 720, width: 640 });
  const settingsContent = page.getByRole("main", { name: "Settings content" });
  const contentWidths = await settingsContent.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(contentWidths.scroll).toBe(contentWidths.client);
  const updatesTitle = await page
    .getByRole("heading", { level: 3, name: "Updates" })
    .boundingBox();
  const checkButton = await page
    .getByRole("button", { name: "Check for updates" })
    .boundingBox();
  expect(checkButton?.y).toBeGreaterThan(
    (updatesTitle?.y ?? 0) + (updatesTitle?.height ?? 0),
  );

  const back = settings.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  await expect(settings.locator('[data-slot="settings-back"]')).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await back.click();

  await expect(
    page.getByRole("navigation", { name: "Projects" }),
  ).toBeVisible();
  await expect(projectFilter).toHaveValue("rebase");
});

test("controls settings from the keyboard", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Control+Comma");
  await expect(
    page.getByRole("navigation", { name: "Settings" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("navigation", { name: "Projects" }),
  ).toBeVisible();
});

test("edits and persists keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Keyboard shortcuts" })
    .click();

  const editToggle = page.getByRole("button", {
    name: "Edit Toggle Projects sidebar shortcut",
  });
  await editToggle.click();
  const popover = page.locator('[data-slot="popover-content"]');
  const capture = popover.getByRole("button").first();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(popover.getByRole("button", { name: "Clear" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(capture).toBeFocused();

  await capture.press("Control+Shift+o");
  await expect(popover.getByRole("status")).toContainText(
    "Show Open Project currently uses Ctrl Shift O.",
  );
  await expect(popover.getByRole("button", { name: "Replace" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Save" })).not.toBeVisible();

  await page.keyboard.press("Control+Shift+b");
  await expect(popover.getByRole("status")).not.toBeVisible();
  await popover.getByRole("button", { name: "Save" }).click();
  await expect(editToggle).toContainText("Shift");
  await expect(
    page.getByRole("button", { name: "Reset Toggle Projects sidebar" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+b");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).not.toBeVisible();
  await page.keyboard.press("Control+Shift+b");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Keyboard shortcuts" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit Toggle Projects sidebar shortcut",
    }),
  ).toContainText("Shift");

  await page
    .getByRole("button", { name: "Edit Toggle Projects sidebar shortcut" })
    .click();
  await page
    .locator('[data-slot="popover-content"]')
    .getByRole("button", { name: "Clear" })
    .click();
  await page
    .locator('[data-slot="popover-content"]')
    .getByRole("button", { name: "Save" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit Toggle Projects sidebar shortcut",
    }),
  ).toContainText("Unassigned");

  await page.getByRole("button", { name: "Reset all" }).click();
  const resetDialog = page.getByRole("alertdialog");
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "Reset all" }).click();
  await expect(
    page.getByRole("button", {
      name: "Edit Toggle Projects sidebar shortcut",
    }),
  ).toContainText("Ctrl");
});
