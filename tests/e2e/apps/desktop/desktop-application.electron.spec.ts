import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

test("pairs the packaged renderer with its managed Environment", async () => {
  const packageMetadata = JSON.parse(
    await readFile("package.json", "utf8"),
  ) as {
    readonly version: string;
  };
  const testHome = await mkdtemp(join(tmpdir(), "rebase-electron-e2e-"));
  const repositoryPath = join(testHome, "rebase-test");
  await mkdir(repositoryPath);
  await execFileAsync("git", ["init", repositoryPath]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  environment.HOME = testHome;
  environment.USERPROFILE = testHome;
  environment.XDG_CONFIG_HOME = testHome;
  delete environment.ELECTRON_RUN_AS_NODE;

  try {
    const application = await electron.launch({
      args: [
        resolve("src/apps/desktop/dist/package/main.js"),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
      ],
      env: environment,
    });

    try {
      const window = await application.firstWindow();

      await expect(window.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
      await window.keyboard.press("Control+o");
      const picker = window.getByRole("dialog", { name: "Choose repository" });
      await expect(picker).toBeVisible();
      await expect(
        picker.getByRole("button", { name: "Select Environment" }),
      ).toHaveText("Local Environment");
      await expect(
        picker.getByRole("button", { name: "Parent directory" }),
      ).toBeEnabled();
      await expect(
        picker.getByRole("button", { name: "Open repository" }),
      ).toBeDisabled();

      await picker.getByRole("button", { name: /rebase-test/ }).click();
      await expect(
        picker.getByRole("button", { name: "Open repository" }),
      ).toBeEnabled();
      await window.keyboard.press("Control+Enter");
      await expect(picker).not.toBeVisible();

      const projects = window.getByRole("navigation", { name: "Projects" });
      const connectionStatus = projects.getByRole("status");
      await expect(connectionStatus).toHaveText("Available");
      await expect(connectionStatus).toHaveClass(/sr-only/);
      await expect(
        projects.getByRole("button", { name: "Close rebase-test" }),
      ).toBeVisible();

      await window.keyboard.press("Control+b");
      await expect(
        projects.getByRole("button", { name: "rebase-test" }),
      ).toBeVisible();
      await projects
        .getByRole("button", {
          name: "Collapse Local Environment, Available",
        })
        .click();
      await expect(
        projects.getByRole("button", { name: "rebase-test" }),
      ).not.toBeVisible();
      await projects
        .getByRole("button", {
          name: "Expand Local Environment, Available",
        })
        .click();
      await expect(
        projects.getByRole("button", { name: "rebase-test" }),
      ).toBeVisible();
      await window.keyboard.press("Control+b");

      await projects.getByRole("button", { name: "Close rebase-test" }).click();
      const openProject = window.getByRole("main", { name: "Open project" });
      await expect(openProject).toBeVisible();
      const recentRepository = openProject
        .getByRole("option")
        .filter({ hasText: "rebase-test" })
        .first();
      await expect(recentRepository).toBeVisible();

      await recentRepository.click();
      await window.keyboard.press("Control+w");
      await expect(openProject).toBeVisible();

      await window.keyboard.press("Control+Shift+f");
      await expect(
        projects.getByRole("textbox", { name: "Filter open projects" }),
      ).toBeFocused();

      await window.keyboard.press("Control+Shift+o");
      await expect(
        openProject.getByRole("searchbox", { name: "Search repositories" }),
      ).toBeFocused();

      await window.keyboard.press("Control+Comma");
      await expect(
        window.getByText(packageMetadata.version, { exact: true }),
      ).toBeVisible();
      await expect(
        window.getByRole("combobox", { name: "Release channel" }),
      ).toBeEnabled();
      await expect(
        window.getByRole("switch", { name: "Check automatically" }),
      ).toBeEnabled();
      await expect(
        window.getByRole("button", { name: "Update now" }),
      ).toBeVisible();

      await window
        .getByRole("navigation", { name: "Settings" })
        .getByRole("button", { name: "Keyboard shortcuts" })
        .click();
      await window
        .getByRole("button", {
          name: "Edit Toggle Projects sidebar shortcut",
        })
        .click();
      const shortcutPopover = window.locator('[data-slot="popover-content"]');
      await expect(shortcutPopover).toBeVisible();
      await expect(shortcutPopover.getByRole("button").first()).toBeFocused();
      await window.keyboard.press("Control+Shift+b");
      await shortcutPopover.getByRole("button", { name: "Save" }).click();
      await expect(
        window.getByRole("button", {
          name: "Edit Toggle Projects sidebar shortcut",
        }),
      ).toContainText("Shift");
    } finally {
      await application.close();
    }

    const restartedApplication = await electron.launch({
      args: [
        resolve("src/apps/desktop/dist/package/main.js"),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
      ],
      env: environment,
    });
    try {
      const restartedWindow = await restartedApplication.firstWindow();
      await expect(restartedWindow.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
      await restartedWindow.getByRole("button", { name: "Settings" }).click();
      await restartedWindow
        .getByRole("navigation", { name: "Settings" })
        .getByRole("button", { name: "Keyboard shortcuts" })
        .click();
      await expect(
        restartedWindow.getByRole("button", {
          name: "Edit Toggle Projects sidebar shortcut",
        }),
      ).toContainText("Shift");
    } finally {
      await restartedApplication.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});
