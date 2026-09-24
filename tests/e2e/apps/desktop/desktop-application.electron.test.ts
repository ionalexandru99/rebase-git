import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import type { DesktopHostBridge } from "@rebase/contracts";
import { createRepository } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

test("opens, closes, and reopens a recent repository after restart", async () => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-electron-e2e-"));

  try {
    const repositoryPath = join(testHome, "rebase-test");
    await createRepository(repositoryPath, {
      commits: ["initial", "follow-up"],
    });
    const environment = await createTestEnvironment(testHome);
    const application = await launchApplication(environment);
    try {
      const window = await connectedWindow(application);
      const credential = await environmentCredential(window);
      expect(credential).toMatch(/^rebase\.v1\./);
      await window.reload();
      await expect(window.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
      expect(await environmentCredential(window)).toBe(credential);
      await openRepository(window, "rebase-test");
      const commit = window
        .getByRole("grid", { name: "Commit history" })
        .getByRole("row", { name: /^initial,/ });
      await expect(commit).toHaveAttribute("aria-selected", "false");
      await commit.click();
      await expect(commit).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => hasCompletedHistory(window)).toBe(true);

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
      const history = restartedWindow.getByRole("grid", {
        name: "Commit history",
      });
      const initial = history.getByRole("row", { name: /^initial,/ });
      await expect(
        history.getByRole("row", { name: /^follow-up,/ }),
      ).toBeVisible();

      await restartedWindow.context().setOffline(true);
      await initial.click();
      await expect(initial).toHaveAttribute("aria-selected", "true");
      await restartedWindow.context().setOffline(false);
    } finally {
      await restartedApplication.close();
    }
  } finally {
    await removeTemporaryDirectory(testHome);
  }
});

async function createTestEnvironment(testHome: string) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const applicationData = join(testHome, "AppData", "Roaming");
  const localApplicationData = join(testHome, "AppData", "Local");
  await Promise.all([
    mkdir(applicationData, { recursive: true }),
    mkdir(localApplicationData, { recursive: true }),
  ]);
  environment.APPDATA = applicationData;
  environment.HOME = testHome;
  environment.LOCALAPPDATA = localApplicationData;
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
  await window.getByRole("button", { name: "Browse files" }).click();
  const picker = window.getByRole("dialog", { name: "Choose repository" });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button")
    .filter({ hasText: repositoryName })
    .first()
    .click();
  await window
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await expect(picker).not.toBeVisible();
}

function environmentCredential(window: Page) {
  return window.evaluate(() =>
    (
      globalThis as { readonly rebaseHost?: DesktopHostBridge }
    ).rebaseHost?.getEnvironmentCredential(),
  );
}

function recentRepository(window: Page, repositoryName: string) {
  return window
    .getByRole("main", { name: "Open project" })
    .getByRole("option")
    .filter({ hasText: repositoryName })
    .first();
}

async function hasCompletedHistory(page: Page) {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open("rebase-repository-history");
        let createdDatabase = false;
        request.onupgradeneeded = () => {
          createdDatabase = true;
          request.transaction?.abort();
        };
        request.onerror = () => {
          if (createdDatabase) {
            resolve(false);
            return;
          }
          reject(request.error);
        };
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("repositories")) {
            database.close();
            resolve(false);
            return;
          }
          const transaction = database.transaction("repositories", "readonly");
          const repositories = transaction.objectStore("repositories").getAll();
          repositories.onerror = () => {
            database.close();
            reject(repositories.error);
          };
          repositories.onsuccess = () => {
            database.close();
            resolve(
              repositories.result.some(
                (repository: { completion?: unknown }) =>
                  repository.completion !== undefined,
              ),
            );
          };
        };
      }),
  );
}
