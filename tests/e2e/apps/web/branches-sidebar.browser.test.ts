import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const cliPath = resolve("src/apps/server/cli.ts");

test("opens a repository and checks out a local branch", async ({ page }) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-branches-e2e-"));
  const repositoryPath = join(testHome, "rebase-test");
  await createRepository(repositoryPath);
  const server = startServer(testHome);

  try {
    const pairingUrl = await server.waitForPairingUrl();
    await page.goto(pairingUrl);
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Connected",
    );

    await page.keyboard.press("Control+o");
    const picker = page.getByRole("dialog", { name: "Choose repository" });
    await picker.getByRole("button", { name: /^rebase-test Folder/ }).click();
    await page.keyboard.press("Control+Enter");
    await expect(picker).not.toBeVisible();
    await expect(
      projects.getByRole("button", { name: "Open rebase-test" }),
    ).toHaveAttribute("aria-current", "page");

    const history = page.getByRole("listbox", { name: "Commit history" });
    const initialCommit = history.getByRole("option", { name: /^initial,/ });
    await expect(
      history.getByRole("option", { name: /^follow-up,/ }),
    ).toHaveAttribute("aria-selected", "true");
    await initialCommit.click();
    await expect(initialCommit).toHaveAttribute("aria-selected", "true");

    const branches = page.getByRole("navigation", { name: "Branches" });
    const tree = branches.getByRole("tree", { name: "Branches" });
    const main = tree.getByRole("treeitem", { name: /^main(?:,|$)/ });
    const feature = tree.getByRole("treeitem", { name: "feature" });
    await expect(main).toHaveAttribute("aria-selected", "true");
    await feature.dblclick();
    await expect(feature).toHaveAttribute("aria-selected", "true");
    await expect(main).toHaveAttribute("aria-selected", "false");
    await expect.poll(() => currentBranch(repositoryPath)).toBe("feature");
  } finally {
    server.child.kill("SIGTERM");
    await rm(testHome, { force: true, recursive: true });
  }
});

test("reopens synchronized history and keeps browsing while offline", async ({
  page,
}) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-history-e2e-"));
  const repositoryPath = join(testHome, "rebase-test");
  await createRepository(repositoryPath);
  const server = startServer(testHome);

  try {
    await page.goto(await server.waitForPairingUrl());
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Connected",
    );
    await openRepository(page, "rebase-test");
    const history = page.getByRole("listbox", { name: "Commit history" });
    const initial = history.getByRole("option", { name: /^initial,/ });
    await expect(
      history.getByRole("option", { name: /^follow-up,/ }),
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
  } finally {
    if (server.child.exitCode === null) server.child.kill("SIGTERM");
    await rm(testHome, { force: true, recursive: true });
  }
});

async function createRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await writeFile(join(path, "README.md"), "hello");
  await git(path, "add", "README.md");
  await git(path, "commit", "-m", "initial");
  await writeFile(join(path, "README.md"), "hello again");
  await git(path, "add", "README.md");
  await git(path, "commit", "-m", "follow-up");
  await git(path, "branch", "feature");
}

async function currentBranch(path: string) {
  const { stdout } = await git(path, "branch", "--show-current");
  return stdout.trim();
}

async function openRepository(page: Page, name: string) {
  await page.keyboard.press("Control+o");
  const picker = page.getByRole("dialog", { name: "Choose repository" });
  await picker
    .getByRole("button", { name: new RegExp(`^${name} Folder`) })
    .click();
  await page.keyboard.press("Control+Enter");
  await expect(picker).not.toBeVisible();
}

async function hasCompletedHistory(page: Page) {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open("rebase-repository-history");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("repositories", "readonly");
          const repositories = transaction.objectStore("repositories").getAll();
          repositories.onerror = () => reject(repositories.error);
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

async function git(path: string, ...arguments_: string[]) {
  return execFileAsync("git", [
    "-C",
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    ...arguments_,
  ]);
}

function startServer(homeDirectory: string) {
  const child = spawn(
    process.execPath,
    ["--conditions=rebase-source", cliPath, "serve"],
    {
      env: {
        ...process.env,
        BROWSER: "none",
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return {
    child,
    waitForPairingUrl: () =>
      waitForOutput(
        child,
        () => stdout.match(/^Pairing URL: (http:\/\/\S+)$/m)?.[1],
        () => stderr,
      ),
  };
}

function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  read: () => string | undefined,
  readError: () => string,
) {
  return new Promise<string>((resolveOutput, rejectOutput) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectOutput(new Error("Timed out waiting for server output."));
    }, 15_000);
    const inspect = () => {
      const output = read();
      if (output !== undefined) {
        cleanup();
        resolveOutput(output);
      }
    };
    const exited = () => {
      cleanup();
      rejectOutput(new Error(`Server exited before ready. ${readError()}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      child.off("exit", exited);
    };
    child.stdout.on("data", inspect);
    child.once("exit", exited);
    inspect();
  });
}
