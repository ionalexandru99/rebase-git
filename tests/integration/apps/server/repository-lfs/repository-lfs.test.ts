import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { CommandProgressUpdate } from "#contracts/command-progress/command-progress.contract.ts";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { RepositoryLfsApi } from "#contracts/repository-lfs/repository-lfs.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { git } from "#tests-support/git.ts";
import {
  cloneLargeFiles,
  createLargeFileRemote,
  png,
  serveLargeFileLocks,
} from "#tests-support/git-lfs.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

async function fixture({
  git: wrap,
}: {
  readonly git?: (runner: GitCommandRunner) => GitCommandRunner;
} = {}) {
  const environment = await openTestEnvironment({ git: wrap });
  const source = await createLargeFileRemote(environment.home);
  const local = join(environment.home, "local");
  await cloneLargeFiles(source.url, local);
  const repositoryId = (await environment.remember(local)).id;
  const scope = { repositoryId, worktreePath: local };
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const progress = (route: string) => {
    const updates: CommandProgressUpdate[] = [];
    environment.progress.subscribe(repositoryId, route, (update) =>
      updates.push(update),
    );
    return updates;
  };
  return {
    ...source,
    local,
    scope,
    run,
    progress,
    lfs: environment.routes(RepositoryLfsApi),
    changes: environment.routes(RepositoryChangesApi),
    commits: environment.routes(CommitInspectionApi),
    pull: environment.routes(RepositoryPullApi),
  };
}

describe("Git LFS repositories", () => {
  it("shows the real content behind pointers and hides pointer line counts", async () => {
    const f = await fixture();
    const after = png([250, 204, 21]);
    await writeFile(join(f.local, "logo.png"), after);
    const changes = await f.run(f.changes.read({ ...f.scope, amend: false }));

    expect(changes.unstaged).toEqual([
      {
        path: "logo.png",
        previousPath: null,
        status: "M",
        lines: null,
        lfs: true,
      },
    ]);
    const diff = await f.run(
      f.changes.diff({
        ...f.scope,
        amend: false,
        section: "unstaged",
        path: "logo.png",
      }),
    );
    expect(diff).toMatchObject({
      kind: "image",
      before: png([56, 189, 248]).toString("base64"),
      after: after.toString("base64"),
    });
    const oid = await git(f.local, "rev-parse", "HEAD");
    const commit = await f.run(f.commits.inspect({ ...f.scope, oid }));
    expect(commit.files).toContainEqual(
      expect.objectContaining({ path: "level.bin", lines: null, lfs: true }),
    );
    expect(
      await f.run(
        f.commits.inspectDiff({ ...f.scope, oid, path: "level.bin" }),
      ),
    ).toMatchObject({ kind: "binary", beforeBytes: 0, afterBytes: 4_096 });
  });

  it("marks content of a commit that is not checked out as not downloaded and downloads it with large-file progress", async () => {
    const f = await fixture();
    await writeFile(join(f.author, "music.bin"), Buffer.alloc(8_192));
    await git(f.author, "add", "music.bin");
    await git(f.author, "commit", "-m", "Add music");
    await git(f.author, "push");
    await git(f.local, "fetch");
    const oid = await git(f.local, "rev-parse", "origin/main");
    const diff = { ...f.scope, oid, path: "music.bin" };
    expect(await f.run(f.commits.inspectDiff(diff))).toMatchObject({
      kind: "missing",
      afterBytes: 8_192,
      largeFileCommits: [oid],
    });
    const updates = f.progress(RepositoryLfsApi.download._tag);

    await f.run(
      f.lfs.download({ ...f.scope, paths: ["music.bin"], commits: [oid] }),
    );

    expect(updates).toContainEqual(
      expect.objectContaining({ largeFiles: true }),
    );
    expect(await f.run(f.commits.inspectDiff(diff))).toMatchObject({
      kind: "binary",
      afterBytes: 8_192,
    });
  });

  it("pulls new large files with their own progress before Git updates the files", async () => {
    const f = await fixture();
    await writeFile(join(f.author, "music.bin"), Buffer.alloc(8_192));
    await git(f.author, "add", "music.bin");
    await git(f.author, "commit", "-m", "Add music");
    await git(f.author, "push");
    await git(f.local, "fetch");
    const updates = f.progress(RepositoryPullApi.pull._tag);

    await f.run(f.pull.pull({ ...f.scope, branch: "main" }));

    expect(updates).toContainEqual(
      expect.objectContaining({ largeFiles: true }),
    );
    expect(await readFile(join(f.local, "music.bin"))).toEqual(
      Buffer.alloc(8_192),
    );
  });

  it("tracks and stops tracking a pattern in .gitattributes", async () => {
    const f = await fixture();

    await f.run(
      f.lfs.setTracked({ ...f.scope, pattern: "*.psd", tracked: true }),
    );
    expect(await f.run(f.lfs.read(f.scope))).toEqual({
      installed: true,
      patterns: ["*.bin", "*.png", "*.psd"],
    });
    await f.run(
      f.lfs.setTracked({ ...f.scope, pattern: "*.psd", tracked: false }),
    );
    expect((await f.run(f.lfs.read(f.scope))).patterns).toEqual([
      "*.bin",
      "*.png",
    ]);
  });

  it("keeps working changes readable and protects large files when Git LFS is missing", async () => {
    const f = await fixture({
      git: (runner) => ({
        ...runner,
        run: (command) =>
          command.arguments[0] === "lfs"
            ? Effect.succeed({ exitCode: 1, stdout: "", stderr: "" })
            : runner.run(command),
      }),
    });
    await git(f.local, "config", "filter.lfs.process", "missing-lfs");
    await git(f.local, "config", "filter.lfs.required", "true");
    await writeFile(join(f.local, "level.bin"), Buffer.alloc(4_096, 1));
    const scope = { ...f.scope, amend: false };

    const changes = await f.run(f.changes.read(scope));
    const failure = await Effect.runPromise(
      Effect.flip(
        f.changes.mutate({
          ...scope,
          revision: changes.revision,
          section: "unstaged",
          action: "stage",
          selection: { _tag: "Files", paths: ["level.bin"] },
        }),
      ),
    );

    expect(changes.unstaged).toContainEqual(
      expect.objectContaining({ path: "level.bin", lfs: true }),
    );
    expect(failure).toEqual({
      _tag: "ChangesFailed",
      reason: "Unsupported",
      detail: "Git LFS isn't installed on this server.",
    });
    expect((await f.run(f.lfs.read(f.scope))).installed).toBe(false);
  });

  it("locks, unlocks and force unlocks files on the large-file server", async () => {
    const server = await serveLargeFileLocks({
      locks: [{ path: "logo.png", owner: "bob" }],
    });
    const f = await fixture();
    await git(f.local, "config", "lfs.url", server.url);

    await f.run(
      f.lfs.setLock({ ...f.scope, path: "level.bin", action: "Lock" }),
    );
    expect(await f.run(f.lfs.locks(f.scope))).toEqual([
      { path: "level.bin", owner: "you", ours: true },
      { path: "logo.png", owner: "bob", ours: false },
    ]);
    await f.run(
      f.lfs.setLock({ ...f.scope, path: "logo.png", action: "ForceUnlock" }),
    );
    await f.run(
      f.lfs.setLock({ ...f.scope, path: "level.bin", action: "Unlock" }),
    );
    expect(server.held()).toEqual([]);
  });

  it("says when the server does not support file locks", async () => {
    const server = await serveLargeFileLocks({ supported: false });
    const f = await fixture();
    await git(f.local, "config", "lfs.url", server.url);

    const failure = await Effect.runPromise(
      Effect.flip(
        f.lfs.setLock({ ...f.scope, path: "level.bin", action: "Lock" }),
      ),
    );

    expect(failure).toEqual({
      _tag: "RepositoryRejected",
      reason: "Incompatible",
      detail: "This server doesn't support file locks.",
    });
  });
});
