import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ChangeSelection,
  type ChangesScope,
  type MutateChanges,
  RepositoryChangesHttpApi,
} from "@rebase/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import type { GitCommand } from "#server/domain/git-command.contract";
import { repositoryChangesFeature } from "#server/features/repository-changes/repository-changes.feature";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { repositoryFeatureClient } from "#tests-integration/apps/server/environment-connection/feature-routes-client";
import { createRepository, fastImport } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});
async function fixture(
  initial = true,
  afterCommand?: (command: GitCommand) => Promise<void>,
  beforeCommand?: (command: GitCommand) => Promise<void>,
) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-changes-")),
  );
  directories.push(directory);
  const git = (...args: string[]) => exec("git", ["-C", directory, ...args]);
  await createRepository(directory, { commits: [] });
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "commit.gpgsign", "false");
  await writeFile(join(directory, "file.txt"), "one\ntwo\nthree\n");
  if (initial) {
    await git("add", ".");
    await git("commit", "-m", "Initial");
  }
  const repositoryId = randomUUID();
  const scope: ChangesScope = {
    repositoryId,
    worktreePath: directory,
    amend: false,
  };
  const runner = createLocalGitCommandRunner();
  const service = repositoryFeatureClient(
    RepositoryChangesHttpApi,
    repositoryChangesFeature,
    {
      access: createRepositoryAccess(
        {
          find: () =>
            Effect.succeed({
              id: repositoryId,
              name: "test",
              path: directory,
              addedAt: new Date().toISOString(),
              lastOpenedAt: new Date().toISOString(),
            }),
        },
        runner,
        createLocalRepositoryWatcher(),
      ),
      git: {
        ...runner,
        run: (command) =>
          Effect.promise(async () => {
            await beforeCommand?.(command);
          }).pipe(
            Effect.andThen(runner.run(command)),
            Effect.tap(() =>
              Effect.promise(async () => {
                await afterCommand?.(command);
              }),
            ),
          ),
      },
      coordination: createRepositoryCoordination(runner),
    },
  );
  const read = (amend = false) =>
    Effect.runPromise(service.read({ ...scope, amend }));
  const diff = (
    section: "staged" | "unstaged" = "unstaged",
    amend = false,
    path = "file.txt",
  ) => Effect.runPromise(service.diff({ ...scope, amend, section, path }));
  const mutate = async (
    action: MutateChanges["action"],
    section: MutateChanges["section"],
    selection: ChangeSelection = { _tag: "All" },
    amend = false,
  ) =>
    Effect.runPromise(
      service.mutate({
        ...scope,
        amend,
        revision: (await read(amend)).revision,
        action,
        section,
        selection,
      }),
    );
  return { directory, git, service, scope, read, diff, mutate };
}

describe("working changes through Git", () => {
  it("rejects external edits while preparing stage", async () => {
    let changed = false;
    const f = await fixture(true, async (command) => {
      if (!changed && command.arguments.includes("add")) {
        changed = true;
        await writeFile(join(command.directory, "file.txt"), "external edit\n");
      }
    });
    await writeFile(join(f.directory, "file.txt"), "reviewed edit\n");
    await expect(f.mutate("stage", "unstaged")).rejects.toMatchObject({
      reason: "Stale",
    });
    expect(changed).toBe(true);
    expect((await f.git("show", ":file.txt")).stdout).toBe("one\ntwo\nthree\n");
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "external edit\n",
    );
  });
  it("keeps the real index locked until the reviewed commit is published", async () => {
    let competingStageRejected = false;
    const f = await fixture(true, async (command) => {
      if (!command.arguments.includes("commit")) return;
      await expect(
        exec("git", ["-C", command.directory, "add", "."]),
      ).rejects.toMatchObject({ code: 128 });
      competingStageRejected = true;
    });
    await writeFile(join(f.directory, "file.txt"), "reviewed\n");
    await f.git("add", ".");
    await writeFile(join(f.directory, "file.txt"), "unstaged\n");
    const snapshot = await f.read();
    await Effect.runPromise(
      f.service.commit({
        ...f.scope,
        revision: snapshot.revision,
        message: "Reviewed",
      }),
    );
    expect(competingStageRejected).toBe(true);
    expect((await f.git("show", "HEAD:file.txt")).stdout).toBe("reviewed\n");
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "unstaged\n",
    );
  });
  it("preserves a replaced untracked file when the discard patch is applied", async () => {
    const f = await fixture(false, undefined, async (command) => {
      if (command.arguments.includes("apply"))
        await writeFile(join(command.directory, "file.txt"), "replacement\n");
    });
    await expect(f.mutate("discard", "unstaged")).rejects.toMatchObject({
      reason: "Conflict",
    });
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "replacement\n",
    );
  });
  it.each(["text", "empty", "binary"])(
    "discards an untracked %s file before the repository has an index",
    async (kind) => {
      const f = await fixture(false);
      if (kind !== "text")
        await writeFile(
          join(f.directory, "file.txt"),
          kind === "empty" ? "" : Buffer.from([0, 255, 1]),
        );
      await f.mutate("discard", "unstaged");
      expect((await f.read()).unstaged).toEqual([]);
    },
  );
  it("applies selected lines to filenames with spaces, quotes and Unicode", async () => {
    const f = await fixture();
    const path =
      process.platform === "win32" ? "a λ file.txt" : 'a "quoted" λ file.txt';
    await writeFile(join(f.directory, path), "before\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "Unusual filename");
    await writeFile(join(f.directory, path), "after\n");
    const diff = await f.diff("unstaged", false, path);
    await f.mutate("stage", "unstaged", {
      _tag: "Lines",
      path,
      revision: diff.revision,
      lines: ["-1", "+1"],
    });
    expect((await f.git("show", `:${path}`)).stdout).toBe("after\n");
    expect((await f.read()).unstaged).toEqual([]);
  });
  it("stages Windows worktree lines using the repository's LF normalization", async () => {
    const f = await fixture();
    await f.git("config", "core.autocrlf", "true");
    await writeFile(join(f.directory, "file.txt"), "ONE\r\ntwo\r\nthree\r\n");
    const diff = await f.diff();
    expect(diff.after).toBe("ONE\ntwo\nthree\n");
    await f.mutate("stage", "unstaged", {
      _tag: "Lines",
      path: "file.txt",
      revision: diff.revision,
      lines: ["-1", "+1"],
    });
    expect((await f.git("show", ":file.txt")).stdout).toBe("ONE\ntwo\nthree\n");
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "ONE\r\ntwo\r\nthree\r\n",
    );
    await f.mutate("unstage", "staged");
    const discard = await f.diff();
    await f.mutate("discard", "unstaged", {
      _tag: "Lines",
      path: "file.txt",
      revision: discard.revision,
      lines: ["-1", "+1"],
    });
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "one\r\ntwo\r\nthree\r\n",
    );
  });
  it("stages and unstages selected lines without changing the worktree", async () => {
    const f = await fixture();
    const content = "ONE\nTWO\nthree\n";
    await writeFile(join(f.directory, "file.txt"), content);
    const diff = await f.diff();
    await f.mutate("stage", "unstaged", {
      _tag: "Lines",
      path: "file.txt",
      revision: diff.revision,
      lines: ["-1", "+1"],
    });
    expect((await f.git("show", ":file.txt")).stdout).toBe("two\nONE\nthree\n");
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(content);
    const staged = await f.diff("staged");
    await f.mutate("unstage", "staged", {
      _tag: "Lines",
      path: "file.txt",
      revision: staged.revision,
      lines: ["-1", "+2"],
    });
    expect((await f.read()).staged).toEqual([]);
  });
  it("handles an initial commit and partially staged untracked files", async () => {
    const f = await fixture(false);
    const diff = await f.diff();
    await f.mutate("stage", "unstaged", {
      _tag: "Lines",
      path: "file.txt",
      revision: diff.revision,
      lines: ["+1"],
    });
    expect((await f.git("show", ":file.txt")).stdout).toBe("one\n");
    const state = await f.read();
    await Effect.runPromise(
      f.service.commit({
        ...f.scope,
        revision: state.revision,
        message: "First",
      }),
    );
    expect((await f.git("show", "HEAD:file.txt")).stdout).toBe("one\n");
    expect((await f.read()).unstaged).toHaveLength(1);
  });
  it("discards staged edits while retaining nonoverlapping unstaged edits", async () => {
    const f = await fixture();
    const before = Array.from({ length: 25 }, (_, i) => `line ${i}\n`).join("");
    await writeFile(join(f.directory, "file.txt"), before);
    await f.git("add", ".");
    await f.git("commit", "-m", "Long file");
    const staged = before.replace("line 1\n", "STAGED\n");
    await writeFile(join(f.directory, "file.txt"), staged);
    await f.git("add", ".");
    await writeFile(
      join(f.directory, "file.txt"),
      staged.replace("line 23\n", "UNSTAGED\n"),
    );
    await f.mutate("discard", "staged");
    expect((await f.read()).staged).toEqual([]);
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      before.replace("line 23\n", "UNSTAGED\n"),
    );
  });
  it("rejects overlapping staged discard without changing either version", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), "staged\n");
    await f.git("add", ".");
    await writeFile(join(f.directory, "file.txt"), "working\n");
    await expect(f.mutate("discard", "staged")).rejects.toMatchObject({
      reason: "Conflict",
    });
    expect((await f.git("show", ":file.txt")).stdout).toBe("staged\n");
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "working\n",
    );
    await f.mutate("stage", "unstaged");
  });
  it("exposes the old commit during amend and retains index edits when amend is disabled", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), "latest\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "Latest message");
    const head = (await f.read()).head;
    expect((await f.read(true)).message).toBe("Latest message");
    expect((await f.read(true)).staged).toHaveLength(1);
    await f.mutate("unstage", "staged", { _tag: "All" }, true);
    expect((await f.read()).head).toBe(head);
    expect((await f.read()).staged).toHaveLength(1);
    expect((await f.diff("staged")).before).toBe("latest\n");
    expect((await f.diff("staged")).after).toBe("one\ntwo\nthree\n");
  });
  it("allows message-only amend and retains files left unstaged", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), "working\n");
    const snapshot = await f.read(true);
    await Effect.runPromise(
      f.service.commit({
        ...f.scope,
        amend: true,
        revision: snapshot.revision,
        message: "Reworded",
      }),
    );
    expect((await f.git("log", "-1", "--format=%s")).stdout.trim()).toBe(
      "Reworded",
    );
    expect((await f.read()).unstaged).toHaveLength(1);
  });
  it("rejects stale mutations and paths from a different worktree", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), "old selection\n");
    const state = await f.read();
    await writeFile(join(f.directory, "file.txt"), "new external edit\n");
    await expect(
      Effect.runPromise(
        f.service.mutate({
          ...f.scope,
          revision: state.revision,
          action: "discard",
          section: "unstaged",
          selection: { _tag: "All" },
        }),
      ),
    ).rejects.toMatchObject({ reason: "Stale" });
    await expect(
      Effect.runPromise(f.service.read({ ...f.scope, worktreePath: tmpdir() })),
    ).rejects.toMatchObject({ reason: "Missing" });
  });
  it.each(["unstaged", "staged"] as const)(
    "discards %s nested edits when Git omits diff prefixes",
    async (section) => {
      const f = await fixture();
      await f.git("config", "diff.noprefix", "true");
      const path = join(f.directory, "src", "file.txt");
      const base = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join("");
      const unstaged = base.replace("line 11\n", "UNSTAGED\n");
      await mkdir(join(f.directory, "src"));
      await writeFile(path, base);
      await f.git("add", ".");
      await f.git("commit", "-m", "Nested");
      await writeFile(path, base.replace("line 0\n", "STAGED\n"));
      if (section === "staged") {
        await f.git("add", ".");
        await writeFile(path, unstaged.replace("line 0\n", "STAGED\n"));
      }
      await f.mutate("discard", section, {
        _tag: "Files",
        paths: ["src/file.txt"],
      });
      expect(await readFile(path, "utf8")).toBe(
        section === "staged" ? unstaged : base,
      );
      expect((await f.read())[section]).toEqual([]);
    },
  );
  it("discards a same-size edit that only the index timestamp marks as changed", async () => {
    const f = await fixture();
    const path = join(f.directory, "file.txt");
    const past = new Date("2020-01-01T00:00:00Z");
    await f.git("config", "core.checkStat", "minimal");
    await utimes(path, past, past);
    await f.git("update-index", "--refresh");
    await writeFile(path, "ONE\ntwo\nthree\n");
    await utimes(path, past, past);
    await utimes(join(f.directory, ".git", "index"), past, past);

    await f.mutate("discard", "unstaged");

    expect(await readFile(path, "utf8")).toBe("one\ntwo\nthree\n");
  });
  it("tracks index-only edits in the linked worktree's own index", async () => {
    const f = await fixture();
    const parent = await realpath(
      await mkdtemp(join(tmpdir(), "rebase-changes-linked-")),
    );
    directories.push(parent);
    const linked = join(parent, "linked");
    await f.git("worktree", "add", "-b", "linked", linked);
    const git = (...args: string[]) => exec("git", ["-C", linked, ...args]);
    await writeFile(join(linked, "file.txt"), "staged\n");
    await git("add", ".");
    await writeFile(join(linked, "file.txt"), "working\n");
    await writeFile(join(parent, "restaged.txt"), "restaged\n");
    const blob = (
      await git("hash-object", "-w", join(parent, "restaged.txt"))
    ).stdout.trim();
    const read = () =>
      Effect.runPromise(f.service.read({ ...f.scope, worktreePath: linked }));
    const before = await read();
    await git("update-index", "--cacheinfo", `100644,${blob},file.txt`);
    const after = await read();
    expect(after.staged).toEqual(before.staged);
    expect(after.unstaged).toEqual(before.unstaged);
    expect(after.revision).not.toBe(before.revision);
  });
  it("views an unstaged diff without writing objects to the repository", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), "unwritten edit\n");
    const objects = async () => (await f.git("count-objects", "-v")).stdout;
    const before = await objects();
    expect((await f.diff()).after).toBe("unwritten edit\n");
    expect(await objects()).toBe(before);
  });
  it("handles binary and literal pathspec filenames at whole-file level", async () => {
    const f = await fixture();
    const path =
      process.platform === "win32" ? "[literal].bin" : ":(glob)*.bin";
    const bytes = Buffer.from([0, 255, 128, 1]);
    await writeFile(join(f.directory, path), bytes);
    expect((await f.diff("unstaged", false, path)).kind).toBe("binary");
    await f.mutate("stage", "unstaged", { _tag: "Files", paths: [path] });
    expect((await f.read()).staged.map((file) => file.path)).toEqual([path]);
    await f.mutate("discard", "staged");
    expect((await f.read()).staged).toEqual([]);
  });
});

const caseInsensitive = await caseInsensitiveFileSystem();

describe("renamed files through Git", () => {
  const original = Array.from({ length: 10 }, (_, i) => `line ${i}\n`).join("");
  const edited = original.replace("line 1\n", "LINE 1\n");
  async function renamed() {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), original);
    await f.git("commit", "-am", "Longer file");
    await f.git("mv", "file.txt", "moved.txt");
    await writeFile(join(f.directory, "moved.txt"), edited);
    await f.git("add", "moved.txt");
    return f;
  }
  const exists = (path: string) =>
    access(path).then(
      () => true,
      () => false,
    );

  it("reads a staged rename with its source and content diff", async () => {
    const f = await renamed();
    expect((await f.read()).staged).toEqual([
      { path: "moved.txt", previousPath: "file.txt", status: "R" },
    ]);
    const diff = await f.diff("staged", false, "moved.txt");
    expect(diff.before).toBe(original);
    expect(diff.after).toBe(edited);
  });
  it("unstages both paths of a rename without touching the worktree", async () => {
    const f = await renamed();
    await f.mutate("unstage", "staged", {
      _tag: "Files",
      paths: ["moved.txt"],
    });
    const changes = await f.read();
    expect(changes.staged).toEqual([]);
    expect(
      changes.unstaged.map((file) => `${file.status} ${file.path}`).sort(),
    ).toEqual(["? moved.txt", "D file.txt"]);
    expect(await readFile(join(f.directory, "moved.txt"), "utf8")).toBe(edited);
  });
  it("discards a rename by restoring the original file", async () => {
    const f = await renamed();
    await f.mutate("discard", "staged");
    const changes = await f.read();
    expect([...changes.staged, ...changes.unstaged]).toEqual([]);
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      original,
    );
    expect(await exists(join(f.directory, "moved.txt"))).toBe(false);
  });
  it("keeps the rename staged when unstaging selected lines", async () => {
    const f = await renamed();
    const diff = await f.diff("staged", false, "moved.txt");
    await f.mutate("unstage", "staged", {
      _tag: "Lines",
      path: "moved.txt",
      revision: diff.revision,
      lines: ["-2", "+2"],
    });
    expect((await f.read()).staged).toEqual([
      { path: "moved.txt", previousPath: "file.txt", status: "R" },
    ]);
    expect((await f.git("show", ":moved.txt")).stdout).toBe(original);
    expect(await readFile(join(f.directory, "moved.txt"), "utf8")).toBe(edited);
  });
  it("refuses to discard a rename over a new file at the original path", async () => {
    const f = await renamed();
    await writeFile(join(f.directory, "file.txt"), "new file\n");
    await expect(f.mutate("discard", "staged")).rejects.toMatchObject({
      reason: "Conflict",
    });
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "new file\n",
    );
    expect(await readFile(join(f.directory, "moved.txt"), "utf8")).toBe(edited);
  });
  it("shows added and deleted files when too many files changed to match renames", async () => {
    const f = await fixture();
    const count = 1001;
    const data = (content: string) => `data <<END\n${content}END\n`;
    const blob = (mark: number, content: string) =>
      `blob\nmark :${mark}\n${data(content)}`;
    const commit = (ref: string, parent: string, changes: string) =>
      `commit ${ref}\ncommitter Test <test@example.com> 0 +0000\n${data("Many files\n")}from ${parent}\n${changes}`;
    const files = (path: string, mark: number) =>
      Array.from(
        { length: count },
        (_, i) => `M 100644 :${mark} ${path}-${i}.txt\n`,
      ).join("");
    await fastImport(
      f.directory,
      blob(1, original) +
        blob(2, edited) +
        commit("refs/heads/main", "refs/heads/main^0", files("from/old", 1)) +
        commit(
          "refs/heads/renamed",
          "refs/heads/main",
          `D from\n${files("to/new", 2)}`,
        ),
    );
    await f.git("read-tree", "renamed");
    const changes = await f.read();
    expect(changes.renamesLimited).toBe(true);
    expect(changes.staged).toHaveLength(count * 2);
    expect(changes.staged.every((file) => file.previousPath === null)).toBe(
      true,
    );
  });
  it.skipIf(!caseInsensitive)(
    "discards a case-only rename without deleting the file",
    async () => {
      const f = await fixture();
      await f.git("mv", "file.txt", "File.txt");
      expect((await f.read()).staged).toEqual([
        { path: "File.txt", previousPath: "file.txt", status: "R" },
      ]);
      await f.mutate("discard", "staged");
      const changes = await f.read();
      expect([...changes.staged, ...changes.unstaged]).toEqual([]);
      expect(await readdir(f.directory)).toContain("file.txt");
      expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
        "one\ntwo\nthree\n",
      );
    },
  );
});

async function caseInsensitiveFileSystem() {
  const directory = await mkdtemp(join(tmpdir(), "rebase-case-"));
  try {
    await writeFile(join(directory, "Probe"), "");
    return await access(join(directory, "probe")).then(
      () => true,
      () => false,
    );
  } finally {
    await removeTemporaryDirectory(directory);
  }
}
