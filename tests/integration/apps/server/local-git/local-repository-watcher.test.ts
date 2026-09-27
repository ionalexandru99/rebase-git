import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryChangeKind } from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { cloneRepository, fastImport, git } from "#tests-support/git";
import { waitForObservation } from "#tests-support/observation";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const committer = "committer Rebase test <rebase@example.test> 0 +0000\n";

describe("local repository watcher", () => {
  for (const entry of ["logs/refs", "logs"])
    it.skipIf(process.platform === "win32" && entry === "logs")(
      `continues watching stash history after ${entry} is replaced`,
      async () => {
        const fixture = await createFixture();
        const gitDirectory = join(fixture.local, ".git");
        const changes = await watch(gitDirectory);
        await waitForObservation(
          () => expect(changes.count()).toBeGreaterThan(0),
          () => git(fixture.local, "branch", "-f", "watcher-ready"),
        );
        const beforeReplacement = changes.count();
        await rename(
          join(gitDirectory, entry),
          join(fixture.root, "previous-logs"),
        );
        await mkdir(join(gitDirectory, "logs", "refs"), { recursive: true });
        await waitForObservation(() =>
          expect(changes.count()).toBeGreaterThan(beforeReplacement),
        );
        let writes = 0;
        const beforeWrite = changes.count();
        await waitForObservation(
          () => expect(changes.count()).toBeGreaterThan(beforeWrite),
          () => {
            writes += 1;
            return writeFile(
              join(gitDirectory, "logs", "refs", "stash"),
              `stash ${writes}`,
            );
          },
        );
      },
    );

  it("watches Git paths with forward slashes on every platform", async () => {
    const fixture = await createFixture();
    const changes = await watch(
      join(fixture.local, ".git").replaceAll("\\", "/"),
    );
    await waitForObservation(
      () => expect(changes.count()).toBeGreaterThan(0),
      () => git(fixture.local, "branch", "-f", "watcher-path"),
    );
  });

  it("reports branch, tag, amended, linked HEAD, packed and stash changes as ref changes", async () => {
    const fixture = await createFixture();
    const linked = join(fixture.root, "linked");
    await git(fixture.local, "worktree", "add", "--detach", linked);
    const changes = await watch(join(fixture.local, ".git"));
    const edits = [
      () => git(fixture.local, "branch", "local-branch"),
      () => git(fixture.local, "tag", "local-tag"),
      () => git(fixture.local, "commit", "--amend", "-m", "first amendment"),
      () => git(linked, "commit", "--allow-empty", "-m", "detached worktree"),
      () => git(fixture.local, "pack-refs", "--all"),
      async () => {
        await writeFile(join(fixture.local, "file.txt"), "stashed");
        await git(fixture.local, "stash", "push", "-m", "stashed");
      },
    ];
    for (const edit of edits) {
      const before = changes.refs();
      await edit();
      await waitForObservation(() =>
        expect(changes.refs()).toBeGreaterThan(before),
      );
    }
  });
});

async function watch(gitDirectory: string) {
  const kinds: RepositoryChangeKind[] = [];
  const handle = await Effect.runPromise(
    createLocalRepositoryWatcher().watch(gitDirectory, (kind) => {
      kinds.push(kind);
    }),
  );
  onTestFinished(() => handle.close());
  return {
    count: () => kinds.length,
    refs: () => kinds.filter((kind) => kind === "Refs").length,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "rebase watcher "));
  onTestFinished(() => removeTemporaryDirectory(root));
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  await git(root, "init", "--bare", "-b", "main", remote);
  await fastImport(
    remote,
    `commit refs/heads/main\n${committer}data <<END\nbase\nEND\nM 100644 inline file.txt\ndata <<END\nbase\nEND\n`,
  );
  await cloneRepository(remote, local);
  return { root, local };
}
