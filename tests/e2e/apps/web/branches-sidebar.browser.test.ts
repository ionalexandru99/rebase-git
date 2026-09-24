import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startEnvironmentServer } from "#tests-support/environment-server";
import { createRepository, git } from "#tests-support/git";

test("opens a repository and checks out a local branch", async ({ page }) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-branches-e2e-"));
  const repositoryPath = join(testHome, "rebase-test");
  await createRepository(repositoryPath, {
    commits: ["initial", "follow-up"],
    branches: ["feature"],
  });
  const server = startEnvironmentServer(testHome);

  try {
    const pairingUrl = await server.waitForPairingUrl();
    await page.goto(pairingUrl);
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Connected",
    );

    await expect(page).toHaveURL(new URL("/", pairingUrl).href);
    const cookies = await page
      .context()
      .cookies(`${new URL(pairingUrl).origin}/api`);
    expect(cookies).toContainEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: "Strict",
        path: "/api",
      }),
    );
    await page.reload();
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Connected",
    );

    const reopened = await page.context().newPage();
    try {
      await reopened.goto(new URL("/", pairingUrl).href);
      await expect(reopened.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
    } finally {
      await reopened.close();
    }

    await page.getByRole("button", { name: "Browse files" }).click();
    const picker = page.getByRole("dialog", { name: "Choose repository" });
    await picker.getByRole("button", { name: /^rebase-test Folder/ }).click();
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(picker).not.toBeVisible();
    await expect(
      projects.getByRole("button", { name: "Open rebase-test" }),
    ).toHaveAttribute("aria-current", "page");

    const history = page.getByRole("grid", { name: "Commit history" });
    const initialCommit = history.getByRole("row", { name: /^initial,/ });
    await expect(
      history.getByRole("row", { name: /^follow-up,/ }),
    ).toHaveAttribute("aria-selected", "false");
    await initialCommit.click();
    await expect(initialCommit).toHaveAttribute("aria-selected", "true");

    const branches = page.getByRole("navigation", { name: "Branches" });
    const tree = branches.getByRole("tree", { name: "Branches" });
    const main = tree.getByRole("treeitem", { name: /^main(?:,|$)/ });
    const feature = tree.getByRole("treeitem", { name: "feature" });
    await expect(main).toHaveAttribute("aria-current", "true");
    await feature.dblclick();
    await expect(feature).toHaveAttribute("aria-current", "true");
    await expect(main).not.toHaveAttribute("aria-current");
    await expect
      .poll(() => git(repositoryPath, "branch", "--show-current"))
      .toBe("feature");
  } finally {
    server.child.kill("SIGTERM");
    await rm(testHome, { force: true, recursive: true });
  }
});

test("reopens cached history and reveals a merged commit through offline search", async ({
  page,
}) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-history-e2e-"));
  const repositoryPath = join(testHome, "rebase-test");
  await createRepository(repositoryPath, {
    commits: ["initial", "follow-up"],
    branches: ["feature"],
  });
  await git(repositoryPath, "switch", "-c", "merged-topic", "HEAD~1");
  await git(
    repositoryPath,
    "commit",
    "--allow-empty",
    "-m",
    "hidden feature work",
  );
  await git(repositoryPath, "switch", "main");
  await git(
    repositoryPath,
    "merge",
    "--no-ff",
    "merged-topic",
    "-m",
    "merge feature",
  );
  await git(repositoryPath, "branch", "-d", "merged-topic");
  const server = startEnvironmentServer(testHome);

  try {
    await page.goto(await server.waitForPairingUrl());
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Connected",
    );
    await openRepository(page, "rebase-test");
    const history = page.getByRole("grid", { name: "Commit history" });
    const initial = history.getByRole("row", { name: /^initial,/ });
    await expect(
      history.getByRole("row", { name: /^follow-up,/ }),
    ).toBeVisible();
    await expect.poll(() => hasCompletedHistory(page)).toBe(true);

    await projects.getByRole("button", { name: "Close rebase-test" }).click();
    await page
      .getByRole("main", { name: "Open project" })
      .getByRole("option")
      .filter({ hasText: "rebase-test" })
      .first()
      .click();
    await expect(initial).toBeVisible();

    server.child.kill("SIGTERM");
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Reconnecting",
    );
    await initial.click();
    await expect(initial).toHaveAttribute("aria-selected", "true");
    const hidden = history.getByRole("row", { name: /^hidden feature work,/ });
    await expect(hidden).not.toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search history" })
      .fill("hidden feature work");
    await page.getByRole("button", { name: /^hidden feature work / }).click();
    await expect(hidden).toHaveAttribute("aria-selected", "true");
    await expect(
      history.getByRole("row", { name: /^merge feature,/ }),
    ).toHaveAttribute("aria-expanded", "true");
  } finally {
    if (server.child.exitCode === null) server.child.kill("SIGTERM");
    await rm(testHome, { force: true, recursive: true });
  }
});

async function openRepository(page: Page, name: string) {
  await page.getByRole("button", { name: "Browse files" }).click();
  const picker = page.getByRole("dialog", { name: "Choose repository" });
  await picker
    .getByRole("button", { name: new RegExp(`^${name} Folder`) })
    .click();
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await expect(picker).not.toBeVisible();
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
