import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { createCommitInspectionService } from "#server/features/commit-inspection/commit-inspection";
import { createRepositoryAccess } from "#server/repository/access/index";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-inspection-")),
  );
  directories.push(directory);
  const git = async (...args: string[]) =>
    (
      await promisify(execFile)("git", ["-C", directory, ...args])
    ).stdout.trim();
  await git("init", "-b", "main");
  await git("config", "user.name", "Inspector");
  await git("config", "user.email", "inspector@example.test");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(directory, "old.txt"), "one\ntwo\nthree\n");
  await git("add", ".");
  await git("commit", "-m", "Initial\n\nFull commit body.");
  const oid = await git("rev-parse", "HEAD");
  const repositoryId = randomUUID();
  const runner = createLocalGitCommandRunner();
  const service = createCommitInspectionService(
    createRepositoryAccess(
      {
        find: () =>
          Effect.succeed({
            id: repositoryId,
            name: "test",
            path: directory,
            addedAt: "",
            lastOpenedAt: "",
          }),
      },
      runner,
      createLocalRepositoryWatcher(),
    ),
    runner,
  );
  const scope = { repositoryId, worktreePath: directory, oid };
  return { directory, git, service, scope };
}

describe("historical commit inspection", () => {
  it("rejects a worktree belonging to a different repository", async () => {
    const selected = await fixture();
    const other = await fixture();
    const failure = await Effect.runPromise(
      Effect.flip(
        selected.service.inspect({
          ...selected.scope,
          worktreePath: other.directory,
        }),
      ),
    );
    expect(failure.failure).toEqual({
      _tag: "ChangesFailed",
      reason: "Missing",
      detail: "This worktree does not belong to the repository.",
    });
  });

  it("reads root metadata and an added-file patch without touching dirty worktree or index", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "old.txt"), "staged\n");
    await f.git("add", ".");
    await writeFile(join(f.directory, "old.txt"), "unstaged\n");
    const index = await readFile(join(f.directory, ".git/index"));
    const details = await Effect.runPromise(f.service.inspect(f.scope));
    expect(details.message).toBe("Initial\n\nFull commit body.\n");
    expect(details.author).toMatchObject({
      name: "Inspector",
      email: "inspector@example.test",
    });
    expect(details.committer).toEqual(details.author);
    expect(details.parents).toEqual([]);
    expect(details.parentOid).toBeNull();
    expect(details.files).toEqual([
      { path: "old.txt", previousPath: null, status: "A" },
    ]);
    const diff = await Effect.runPromise(
      f.service.inspectDiff({ ...f.scope, path: "old.txt" }),
    );
    expect(diff.before).toBeNull();
    expect(diff.after).toBe("one\ntwo\nthree\n");
    expect(diff.patch).toContain("+one");
    expect(await f.git("rev-parse", "HEAD")).toBe(f.scope.oid);
    expect(await readFile(join(f.directory, ".git/index"))).toEqual(index);
    expect(await readFile(join(f.directory, "old.txt"), "utf8")).toBe(
      "unstaged\n",
    );
  });

  it("reads renamed paths and binary files from the selected revision", async () => {
    const f = await fixture();
    const path = "renamed λ file.txt";
    await f.git("mv", "old.txt", path);
    await writeFile(join(f.directory, path), "one\ntwo\nthree\nfour\n");
    await writeFile(join(f.directory, "binary.dat"), Buffer.from([0, 255, 1]));
    await f.git("add", ".");
    await f.git("commit", "-m", "Rename and add binary");
    const scope = { ...f.scope, oid: await f.git("rev-parse", "HEAD") };
    const details = await Effect.runPromise(f.service.inspect(scope));
    expect(details.parentOid).toBe(f.scope.oid);
    expect(details.files).toContainEqual({
      path,
      previousPath: "old.txt",
      status: "R",
    });
    const diff = await Effect.runPromise(
      f.service.inspectDiff({ ...scope, path, previousPath: "old.txt" }),
    );
    expect(diff.before).toBe("one\ntwo\nthree\n");
    expect(diff.after).toBe("one\ntwo\nthree\nfour\n");
    expect(diff.patch).toContain("+four");
    expect(
      await Effect.runPromise(
        f.service.inspectDiff({ ...scope, path: "binary.dat" }),
      ),
    ).toMatchObject({ kind: "binary", beforeBytes: 0, afterBytes: 3 });
  });

  it("pairs each file with its own patch when the paths are not a rename", async () => {
    const f = await fixture();
    await f.git("rm", "-q", "old.txt");
    await writeFile(join(f.directory, "new.txt"), "unrelated\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "Replace");
    const scope = { ...f.scope, oid: await f.git("rev-parse", "HEAD") };
    const diff = await Effect.runPromise(
      f.service.inspectDiff({
        ...scope,
        path: "new.txt",
        previousPath: "old.txt",
      }),
    );
    expect(diff).toMatchObject({
      kind: "text",
      before: null,
      after: "unrelated\n",
    });
    expect(diff.patch).toContain("+unrelated");
    expect(diff.patch).not.toContain("-one");
  });

  it("shows text patches for files that Git attributes mark as binary", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, ".gitattributes"), "*.txt -diff\n");
    await writeFile(join(f.directory, "old.txt"), "one\ntwo\nthree\nfour\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "Mark text as binary");
    const scope = { ...f.scope, oid: await f.git("rev-parse", "HEAD") };
    const diff = await Effect.runPromise(
      f.service.inspectDiff({ ...scope, path: "old.txt" }),
    );
    expect(diff.kind).toBe("text");
    expect(diff.patch).toContain("+four");
  });

  it("reports sizes without previewing files over the preview limit", async () => {
    const f = await fixture();
    const large = (line: string) => `${line}\n`.repeat(30_000);
    await writeFile(join(f.directory, "large.txt"), large("before"));
    await f.git("add", ".");
    await f.git("commit", "-m", "Add large");
    await writeFile(join(f.directory, "large.txt"), large("after!"));
    await f.git("commit", "-am", "Change large");
    const scope = { ...f.scope, oid: await f.git("rev-parse", "HEAD") };
    expect(
      await Effect.runPromise(
        f.service.inspectDiff({ ...scope, path: "large.txt" }),
      ),
    ).toMatchObject({
      kind: "large",
      before: null,
      after: null,
      patch: "",
      beforeBytes: 210_000,
      afterBytes: 210_000,
    });
  });

  it("compares a merge to each explicit parent and rejects unrelated parents and paths", async () => {
    const f = await fixture();
    await f.git("checkout", "-b", "topic");
    await writeFile(join(f.directory, "topic.txt"), "topic\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "Topic");
    const topic = await f.git("rev-parse", "HEAD");
    await f.git("checkout", "main");
    await writeFile(join(f.directory, "main.txt"), "main\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "Main");
    const main = await f.git("rev-parse", "HEAD");
    await f.git("merge", "--no-ff", "topic", "-m", "Merge topic");
    const scope = { ...f.scope, oid: await f.git("rev-parse", "HEAD") };
    const first = await Effect.runPromise(f.service.inspect(scope));
    expect(first.parents).toEqual([main, topic]);
    expect(first.parentOid).toBe(main);
    expect(first.files.map((file) => file.path)).toEqual(["topic.txt"]);
    const second = await Effect.runPromise(
      f.service.inspect({ ...scope, parentOid: topic }),
    );
    expect(second.files.map((file) => file.path)).toEqual(["main.txt"]);
    expect(
      (
        await Effect.runPromise(
          f.service.inspectDiff({
            ...scope,
            parentOid: topic,
            path: "main.txt",
          }),
        )
      ).after,
    ).toBe("main\n");
    await expect(
      Effect.runPromise(
        f.service.inspect({ ...scope, parentOid: f.scope.oid }),
      ),
    ).rejects.toMatchObject({ failure: { reason: "Unsupported" } });
    await expect(
      Effect.runPromise(f.service.inspectDiff({ ...scope, path: "../secret" })),
    ).rejects.toMatchObject({ failure: { reason: "Missing" } });
    await expect(
      Effect.runPromise(
        f.service.inspect({ ...scope, worktreePath: tmpdir() }),
      ),
    ).rejects.toMatchObject({ failure: { reason: "Missing" } });
  });

  it("supports empty commits and rejects revision expressions", async () => {
    const f = await fixture();
    await f.git("commit", "--allow-empty", "-m", "Empty");
    const scope = { ...f.scope, oid: await f.git("rev-parse", "HEAD") };
    expect((await Effect.runPromise(f.service.inspect(scope))).files).toEqual(
      [],
    );
    await expect(
      Effect.runPromise(f.service.inspect({ ...scope, oid: "HEAD^{tree}" })),
    ).rejects.toMatchObject({ failure: { reason: "Unsupported" } });
  });
});
