import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { startEnvironmentServer } from "#tests-support/environment-server.ts";
import { createConflictedRebase, git } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

test("rebases onto main from the branch menu, resolves each conflict block in the Diffs tab and continues", async ({
  page,
}) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-conflicts-e2e-"));
  const repositoryPath = await createConflictedRebase(testHome, {
    files: "text",
    paused: false,
  });
  await git(repositoryPath, "config", "user.name", "Rebase test");
  await git(repositoryPath, "config", "user.email", "rebase@example.test");
  const server = startEnvironmentServer(testHome);

  try {
    await page.goto(await server.waitForPairingUrl());
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("status")).toHaveText("Available");
    await page.getByRole("button", { name: "Browse files" }).click();
    const picker = page.getByRole("dialog", { name: "Choose repository" });
    await picker
      .getByRole("button", {
        name: new RegExp(`^${basename(repositoryPath)} Folder`),
      })
      .click();
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(picker).not.toBeVisible();

    await page
      .getByRole("navigation", { name: "Branches" })
      .getByRole("treeitem", { name: "main", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rebase", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Onto here", exact: true })
      .click();
    await page.getByRole("button", { name: "Review conflicts" }).click();
    const conflicts = page.getByRole("region", { name: "Conflicted files" });
    await expect(
      conflicts.getByRole("button", { name: "Conflict two.txt" }),
    ).toBeVisible();

    await conflicts.getByRole("button", { name: "Conflict two.txt" }).click();
    await expect(
      page.getByRole("button", { name: "Restore side panel" }),
    ).toBeVisible();
    const file = page.getByRole("region", { name: "Working file" });
    await file
      .getByRole("button", { name: "Accept current change" })
      .first()
      .click();
    const incoming = file.getByRole("button", {
      name: "Accept incoming change",
    });
    await expect(incoming).toHaveCount(1);
    await incoming.click();
    await expect
      .poll(() => readFile(join(repositoryPath, "two.txt"), "utf8"))
      .toBe("a\nB current\nc\nd\ne\nf\nG incoming\nh\n");
    await page
      .getByRole("button", { name: "Mark resolved", exact: true })
      .click();

    await expect(
      conflicts.getByRole("button", { name: "Conflict added.txt" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(incoming).toHaveCount(1);
    await incoming.click();
    await expect
      .poll(() => readFile(join(repositoryPath, "added.txt"), "utf8"))
      .toBe("added by incoming\n");
    await page
      .getByRole("button", { name: "Mark resolved", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Expand side panel" }),
    ).toBeVisible();

    const operation = page.getByRole("region", { name: "Operation" });
    await expect(operation.getByRole("heading")).toContainText(
      "ready to continue",
    );
    await operation.getByRole("button", { name: "Continue rebase" }).click();
    await expect
      .poll(() =>
        git(repositoryPath, "--no-optional-locks", "status", "--porcelain"),
      )
      .toBe("");
    await expect
      .poll(() => git(repositoryPath, "log", "-1", "--format=%s"))
      .toBe("incoming change");
  } finally {
    server.child.kill("SIGTERM");
    await removeTemporaryDirectory(testHome);
  }
});
