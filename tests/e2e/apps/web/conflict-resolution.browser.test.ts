import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { createConflictedRebase } from "#tests-support/conflicted-repository";
import { startEnvironmentServer } from "#tests-support/environment-server";
import { git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

test("resolves a paused rebase line by line and continues it", async ({
  page,
}) => {
  const testHome = await mkdtemp(join(tmpdir(), "rebase-conflicts-e2e-"));
  const repositoryPath = await createConflictedRebase(testHome);
  await git(repositoryPath, "config", "user.name", "Rebase test");
  await git(repositoryPath, "config", "user.email", "rebase@example.test");
  const server = startEnvironmentServer(testHome);

  try {
    await page.goto(await server.waitForPairingUrl());
    const projects = page.getByRole("navigation", { name: "Projects" });
    await expect(projects.getByRole("status")).toHaveAttribute(
      "data-connection-state",
      "Connected",
    );
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

    await page.getByRole("button", { name: "Review conflicts" }).click();
    const conflicts = page.getByRole("region", { name: "Conflicted files" });
    await expect(
      conflicts.getByRole("button", { name: "Conflict two.txt" }),
    ).toBeVisible();

    await conflicts.getByRole("button", { name: "Conflict two.txt" }).click();
    await page.getByRole("button", { name: "Merge view" }).click();
    const mergeView = page.getByRole("region", { name: "Merge view" });
    await expect(mergeView.getByText("2 of 2 open")).toBeVisible();
    await mergeView
      .getByRole("button", { name: "Current line 1, region 1" })
      .click();
    await mergeView
      .getByRole("button", { name: "Incoming line 1, region 2" })
      .click();
    await expect(mergeView.getByText("0 of 2 open")).toBeVisible();
    await expect
      .poll(() => readFile(join(repositoryPath, "two.txt"), "utf8"))
      .toBe("a\nB current\nc\nd\ne\nf\nG incoming\nh\n");
    await mergeView.getByRole("button", { name: "Mark resolved" }).click();

    await expect(mergeView.getByText("1 of 1 open")).toBeVisible();
    await mergeView
      .getByRole("button", { name: "Incoming line 1, region 1" })
      .click();
    await mergeView.getByRole("button", { name: "Mark resolved" }).click();

    for (const path of [
      "image.bin",
      "removed-here.txt",
      "removed-there.txt",
      "new-name.txt",
      "old-name.txt",
    ]) {
      const row = conflicts.getByRole("button", { name: `Conflict ${path}` });
      if (!(await row.isVisible())) continue;
      await expect(projects.getByRole("status")).toHaveAttribute(
        "data-connection-state",
        "Connected",
      );
      await row.click();
      await page
        .getByTestId("change-diff")
        .getByRole("button", { name: "Whole file" })
        .click();
      await page
        .getByRole("menuitem", { name: /^(Use incoming|Keep deletion)$/ })
        .first()
        .click();
      await expect(row).not.toBeVisible();
    }

    const operation = page.getByRole("region", { name: "Operation" });
    const continueRebase = operation.getByRole("button", {
      name: "Continue rebase",
    });
    const stale = operation.getByRole("alert").filter({
      hasText: "Git state changed",
    });
    await expect(operation.getByRole("heading")).toContainText(
      "ready to continue",
    );
    await continueRebase.click();
    await expect
      .poll(async () => {
        if (await stale.isVisible()) await continueRebase.click();
        return git(repositoryPath, "status", "--porcelain");
      })
      .toBe("");
    await expect
      .poll(() => git(repositoryPath, "log", "-1", "--format=%s"))
      .toBe("incoming change");
  } finally {
    server.child.kill("SIGTERM");
    await removeTemporaryDirectory(testHome);
  }
});
