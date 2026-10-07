import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import {
  maximumFileBytes,
  maximumSearchResults,
  WorktreeFilesApi,
} from "#contracts/worktree-files/worktree-files.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

describe("worktree files", () => {
  it("lists one folder with ignored, submodule and nested entries, and reads files as they are on disk", async () => {
    const path = await temporaryRepository();
    await writeFile(join(path, ".gitignore"), "build/\n");
    await mkdir(join(path, "src", "deep"), { recursive: true });
    await writeFile(join(path, "src", "app.ts"), "export const app = 1;\n");
    await writeFile(join(path, "src", "deep", "leaf.ts"), "leaf\n");
    await mkdir(join(path, "build"));
    await writeFile(join(path, "build", "out.js"), "out\n");
    await writeFile(join(path, "logo.png"), Buffer.from([137, 80, 0, 1]));
    await writeFile(
      join(path, "large.txt"),
      "line\n".repeat(maximumFileBytes / 4),
    );
    await mkdir(join(path, "vendor"));
    await writeFile(join(path, "vendor", ".git"), "gitdir: elsewhere\n");
    await git(path, "add", ".gitignore", "src");
    await git(path, "commit", "-m", "add");
    const oid = await git(path, "rev-parse", "HEAD");
    await git(
      path,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${oid},vendor`,
    );
    await writeFile(join(path, "src", "app.ts"), "export const app = 2;\n");
    const files = await filesClient(path);

    const root = await files.list("");
    const src = await files.list("src");

    expect(root).toEqual({
      entries: [
        { name: ".gitignore", kind: "file", ignored: false },
        { name: "build", kind: "folder", ignored: true },
        { name: "large.txt", kind: "file", ignored: false },
        { name: "logo.png", kind: "file", ignored: false },
        { name: "src", kind: "folder", ignored: false },
        { name: "vendor", kind: "submodule", ignored: false },
      ],
      complete: true,
    });
    expect(src.entries.map(({ name, kind }) => [name, kind])).toEqual([
      ["app.ts", "file"],
      ["deep", "folder"],
    ]);
    expect(await files.read("src/app.ts")).toEqual({
      _tag: "Text",
      contents: "export const app = 2;\n",
      bytes: 22,
      truncated: false,
    });
    expect(await files.read("logo.png")).toEqual({ _tag: "Binary", bytes: 4 });
    expect(await files.read("vendor")).toEqual({ _tag: "Submodule", oid });
    expect(await files.read("gone.ts")).toEqual({ _tag: "Missing" });
    const large = await files.read("large.txt");
    expect(large).toMatchObject({ _tag: "Text", truncated: true });
    expect(large._tag === "Text" && large.contents.endsWith("line\n")).toBe(
      true,
    );
    await expect(files.read("../outside.txt")).rejects.toMatchObject({
      _tag: "RepositoryRejected",
    });
  });

  it.skipIf(process.platform === "win32")(
    "opens a symlink as its target and never lists through it",
    async () => {
      const path = await temporaryRepository();
      const outside = await realpath(await mkdtemp(join(tmpdir(), "outside ")));
      onTestFinished(() => removeTemporaryDirectory(outside));
      await writeFile(join(outside, "secret.txt"), "secret\n");
      await symlink(outside, join(path, "escape"));
      const files = await filesClient(path);

      const root = await files.list("");

      expect(root.entries).toEqual([
        { name: "escape", kind: "symlink", ignored: false },
      ]);
      expect(await files.read("escape")).toEqual({
        _tag: "Symlink",
        target: outside,
      });
      await expect(files.list("escape")).rejects.toMatchObject({
        _tag: "RepositoryRejected",
      });
    },
  );

  it("searches names and uncommitted text, leaving ignored files out and bounding the results", async () => {
    const path = await temporaryRepository();
    await writeFile(join(path, ".gitignore"), "ignored/\n");
    await mkdir(join(path, "src"));
    await mkdir(join(path, "ignored"));
    await writeFile(
      join(path, "src", "stash-panel.tsx"),
      "export function StashPanel() {}\n",
    );
    await writeFile(
      join(path, "stash.ts"),
      "import { StashPanel } from './src/stash-panel.tsx';\n",
    );
    await writeFile(join(path, "ignored", "stash.ts"), "StashPanel\n");
    await writeFile(
      join(path, "many.txt"),
      "needle\n".repeat(maximumSearchResults + 5),
    );
    await git(path, "add", ".gitignore", "src");
    await git(path, "commit", "-m", "add");
    await createRepository(join(path, "stash-nested"));
    const files = await filesClient(path);

    const names = await files.searchNames("STASH");
    const text = await files.searchText("StashPanel");
    const capped = await files.searchText("needle");
    const none = await files.searchText("absent");

    expect(names).toEqual({
      paths: ["stash.ts", "src/stash-panel.tsx"],
      complete: true,
    });
    expect(text).toEqual({
      matches: [
        {
          path: "src/stash-panel.tsx",
          line: 1,
          text: "export function StashPanel() {}",
        },
        {
          path: "stash.ts",
          line: 1,
          text: "import { StashPanel } from './src/stash-panel.tsx';",
        },
      ],
      complete: true,
    });
    expect(capped.matches).toHaveLength(maximumSearchResults);
    expect(capped.complete).toBe(false);
    expect(none).toEqual({ matches: [], complete: true });
  });
});

async function filesClient(path: string) {
  const environment = await openTestEnvironment();
  const repositoryId = (await environment.remember(path)).id;
  const routes = environment.routes(WorktreeFilesApi);
  const scope = { repositoryId, worktreePath: path };
  return {
    list: (folder: string) =>
      Effect.runPromise(routes.list({ ...scope, folder })),
    read: (file: string) =>
      Effect.runPromise(routes.read({ ...scope, path: file })),
    searchNames: (query: string) =>
      Effect.runPromise(routes.searchNames({ ...scope, query })),
    searchText: (query: string) =>
      Effect.runPromise(routes.searchText({ ...scope, query })),
  };
}

async function temporaryRepository() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase worktree files ")),
  );
  onTestFinished(() => removeTemporaryDirectory(directory));
  const path = join(directory, "repository");
  await createRepository(path);
  return path;
}
