import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const cliPath = resolve("src/apps/server/cli.ts");

test("checks out branches and tags from the branches sidebar", async ({
  page,
}) => {
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

    const branches = page.getByRole("navigation", { name: "Branches" });
    const tree = branches.getByRole("tree", { name: "Branches" });
    await expect(
      branches.getByRole("heading", { level: 2, name: "Branches" }),
    ).toBeVisible();
    const main = tree.getByRole("treeitem", { name: /^main(?:,|$)/ });
    const feature = tree.getByRole("treeitem", { name: "feature" });
    const topic = tree.getByRole("treeitem", {
      name: "topic, checked out in another worktree",
      exact: true,
    });
    await expect(main).toHaveAccessibleName("main, this worktree");
    await expect(main).toHaveAttribute("aria-selected", "true");
    await expect(feature).toHaveAttribute("aria-selected", "false");
    await expect(
      main.getByText("This worktree", { exact: true }),
    ).toBeVisible();
    await expect(topic.getByText("Worktree", { exact: true })).toBeVisible();
    await expect(
      tree.getByRole("treeitem", { name: "Tags, 1" }),
    ).toHaveAttribute("aria-expanded", "false");
    await page.screenshot({
      path: "tests/.artifacts/branches-sidebar.png",
    });

    await feature.click();
    await expect(main).toHaveAttribute("aria-selected", "true");
    await expect(feature).toHaveAttribute("aria-selected", "false");

    await feature.dblclick();
    await expect(feature).toHaveAttribute("aria-selected", "true");
    await expect(main).toHaveAttribute("aria-selected", "false");

    await main.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Checkout" }).click();
    await expect(main).toHaveAttribute("aria-selected", "true");
    await expect(feature).toHaveAttribute("aria-selected", "false");
    await feature.dblclick();
    await expect(feature).toHaveAttribute("aria-selected", "true");

    const widthBefore = (await branches.boundingBox())?.width ?? 0;
    const handle = page.locator('[data-slot="resizable-handle"]').nth(1);
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("The branches handle is missing.");
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 120, handleBox.y + 100, { steps: 6 });
    await page.mouse.up();
    expect((await branches.boundingBox())?.width ?? 0).toBeGreaterThan(
      widthBefore + 80,
    );

    await page.keyboard.press("Control+Shift+b");
    await expect(tree).toBeFocused();
    await page.keyboard.press("/");
    const filter = branches.getByRole("textbox", { name: "Filter branches" });
    await expect(filter).toBeFocused();
    await filter.fill("mai");
    await expect(tree.getByRole("treeitem", { name: "feature" })).toHaveCount(
      0,
    );
    await expect(main).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(filter).toHaveValue("");

    await page.keyboard.press("Control+Shift+b");
    await expect(tree).toBeFocused();
    await expect(tree).toHaveAttribute("aria-activedescendant", /feature/);
    await page.keyboard.press("ArrowDown");
    await expect(tree).toHaveAttribute("aria-activedescendant", /topic$/);
    await page.keyboard.press("ArrowDown");
    await expect(tree).toHaveAttribute("aria-activedescendant", /main$/);
    await page.keyboard.press("Enter");
    await expect(main).toHaveAttribute("aria-selected", "true");
    await expect(feature).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("End");
    await expect(tree).toHaveAttribute("aria-activedescendant", /tags/);
    await page.keyboard.press("ArrowRight");
    const tag = tree.getByRole("treeitem", { name: "v1.0.0" });
    await expect(tag).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await expect(tree).toHaveAttribute("aria-activedescendant", /section:tags/);
    await page.keyboard.press("ArrowLeft");
    await expect(tag).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(feature).toHaveAttribute("aria-selected", "false");
    await expect(main).toHaveAttribute("aria-selected", "false");
    await page.screenshot({
      path: "tests/.artifacts/branches-sidebar-detached.png",
    });
    await expect(tree).not.toHaveAttribute("title", /.+/);
    await expect(tree).toHaveAttribute("aria-keyshortcuts", "Control+Shift+b");
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Keyboard shortcuts" })
      .click();
    await page
      .getByRole("button", { name: "Edit Focus Branches sidebar shortcut" })
      .click();
    const popover = page.locator('[data-slot="popover-content"]');
    await popover.getByRole("button").first().press("Control+Shift+k");
    await popover.getByRole("button", { name: "Save" }).click();
    await page.keyboard.press("Escape");
    await expect(tree).toHaveAttribute("aria-keyshortcuts", "Control+Shift+k");
    await filter.focus();
    await page.keyboard.press("Control+Shift+k");
    await expect(tree).toBeFocused();
  } finally {
    server.child.kill("SIGTERM");
    await rm(testHome, { force: true, recursive: true });
  }
});

async function createRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await writeFile(join(path, "README.md"), "hello");
  await git(path, "add", "README.md");
  await git(path, "commit", "-m", "initial");
  await git(path, "tag", "v1.0.0");
  await git(path, "branch", "feature");
  await git(path, "worktree", "add", "-b", "topic", `${path}-topic`);
}

async function git(path: string, ...arguments_: string[]) {
  await execFileAsync("git", [
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
