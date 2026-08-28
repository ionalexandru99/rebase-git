import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

const execFileAsync = promisify(execFile);

test("opens, closes, and reopens a recent repository after restart", async () => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-electron-e2e-"));
  const repositoryPath = join(testHome, "rebase-test");
  await mkdir(repositoryPath);
  await execFileAsync("git", ["init", repositoryPath]);
  const environment = createTestEnvironment(testHome);

  try {
    const application = await launchApplication(environment);
    try {
      const window = await connectedWindow(application);
      await openRepository(window, "rebase-test");

      const projects = window.getByRole("navigation", { name: "Projects" });
      await expect(
        projects.getByRole("button", { name: "Close rebase-test" }),
      ).toBeVisible();
      await projects.getByRole("button", { name: "Close rebase-test" }).click();
      await expect(recentRepository(window, "rebase-test")).toBeVisible();
    } finally {
      await application.close();
    }

    const restartedApplication = await launchApplication(environment);
    try {
      const restartedWindow = await connectedWindow(restartedApplication);
      const repository = recentRepository(restartedWindow, "rebase-test");
      await expect(repository).toBeVisible();
      await repository.click();
      await expect(
        restartedWindow.getByRole("button", { name: "Close rebase-test" }),
      ).toBeVisible();
    } finally {
      await restartedApplication.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});

test("edits a shortcut, restarts, and uses it", async () => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-electron-e2e-"));
  const environment = createTestEnvironment(testHome);

  try {
    const application = await launchApplication(environment);
    try {
      const window = await connectedWindow(application);
      await window.getByRole("button", { name: "Settings" }).click();
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
      await window.keyboard.press("Control+Shift+k");
      await shortcutPopover.getByRole("button", { name: "Save" }).click();
    } finally {
      await application.close();
    }

    const restartedApplication = await launchApplication(environment);
    try {
      const restartedWindow = await connectedWindow(restartedApplication);
      await restartedWindow.getByRole("button", { name: "Settings" }).click();
      await restartedWindow
        .getByRole("navigation", { name: "Settings" })
        .getByRole("button", { name: "Keyboard shortcuts" })
        .click();
      const shortcut = restartedWindow.getByRole("button", {
        name: "Edit Toggle Projects sidebar shortcut",
      });
      await expect(shortcut).toContainText("Shift");
      await expect(shortcut).toContainText("K");
      await restartedWindow.keyboard.press("Escape");
      await expect(
        restartedWindow.getByRole("heading", { level: 1, name: "Projects" }),
      ).toBeVisible();
      await restartedWindow.keyboard.press("Control+Shift+k");
      await expect(
        restartedWindow.getByRole("heading", { level: 1, name: "Projects" }),
      ).not.toBeVisible();
    } finally {
      await restartedApplication.close();
    }
  } finally {
    await rm(testHome, { force: true, recursive: true });
  }
});

function createTestEnvironment(testHome: string) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  environment.HOME = testHome;
  environment.USERPROFILE = testHome;
  environment.XDG_CONFIG_HOME = testHome;
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function launchApplication(environment: Record<string, string>) {
  return electron.launch({
    args: [
      resolve("src/apps/desktop/dist/package/main.js"),
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
    ],
    env: environment,
  });
}

async function connectedWindow(application: ElectronApplication) {
  const window = await application.firstWindow();
  await expect(window.getByRole("status")).toHaveAttribute(
    "data-connection-state",
    "Connected",
  );
  return window;
}

async function openRepository(window: Page, repositoryName: string) {
  await window.keyboard.press("Control+o");
  const picker = window.getByRole("dialog", { name: "Choose repository" });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button")
    .filter({ hasText: repositoryName })
    .first()
    .click();
  await window.keyboard.press("Control+Enter");
  await expect(picker).not.toBeVisible();
}

function recentRepository(window: Page, repositoryName: string) {
  return window
    .getByRole("main", { name: "Open project" })
    .getByRole("option")
    .filter({ hasText: repositoryName })
    .first();
}
