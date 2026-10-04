import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startEnvironmentServer } from "#tests-support/environment-server.ts";
import { createRepository } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

test("runs a command in the worktree's shell and keeps its output across a reload", async ({
  page,
}) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-terminal-e2e-"));
  await createRepository(join(testHome, "rebase-test"));
  const server = startEnvironmentServer(testHome, [], { SHELL: "/bin/sh" });

  try {
    await page.goto(await server.waitForPairingUrl());
    await page.getByRole("button", { name: "Browse files" }).click();
    await page
      .getByRole("dialog", { name: "Choose repository" })
      .getByRole("button", { name: /^rebase-test Repository/ })
      .click();
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();

    await page.getByRole("button", { name: "Show terminal" }).click();
    await expect(page.getByRole("tab", { name: "Terminal 1" })).toBeVisible();
    await page.keyboard.type(
      'test "$(git rev-parse --is-inside-work-tree)" = true && echo $((40 + 2))',
    );
    await page.keyboard.press("Enter");
    const terminal = page.getByRole("region", { name: "Terminal" });
    await expect(terminal).toContainText("42");

    await page.reload();
    await page
      .getByRole("main", { name: "Open project" })
      .getByRole("option")
      .filter({ hasText: "rebase-test" })
      .first()
      .click();
    await expect(terminal).toContainText("42");
    await expect(
      page.getByRole("button", { name: "Hide terminal" }),
    ).toBeVisible();
  } finally {
    server.child.kill("SIGTERM");
    await removeTemporaryDirectory(testHome);
  }
});
