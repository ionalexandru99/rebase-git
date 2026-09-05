import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { RepositoryHistoryBatch } from "@rebase/contracts";
import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";
import { readRepositoryHistorySnapshot } from "#server/features/repository-history/git/read-repository-history-snapshot";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";

const exec = promisify(execFile);
const repositoryId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

it("preserves true shallow parents and invalidates the old basis when external deepening leaves refs unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "rebase shallow "));
  const source = join(root, "source");
  const clone = join(root, "clone");
  const git = createLocalGitCommandRunner();
  let close: (() => void) | undefined;
  try {
    await command(root, "init", "-b", "main", source);
    for (let index = 0; index < 4; index += 1)
      await command(source, "commit", "--allow-empty", "-m", `commit ${index}`);
    await command(
      root,
      "clone",
      "--depth=2",
      pathToFileURL(source).href,
      clone,
    );
    const oids = (await command(source, "rev-list", "HEAD")).split("\n");
    const snapshot = await Effect.runPromise(
      readRepositoryHistorySnapshot(git, clone),
    );
    expect(snapshot.shallowOids).toEqual([oids[1]]);
    const page = await Effect.runPromise(
      readRepositoryHistory(git, clone, {
        _tag: "ReadRepositoryHistory",
        repositoryId,
        requestId,
        limit: 100,
        order: "topological",
        roots: snapshot.refTargets.filter((ref) => ref.type === "branch"),
      }),
    );
    expect(page.commits).toHaveLength(2);
    expect(page.commits[1]?.parents).toEqual([oids[2]]);
    const batches: RepositoryHistoryBatch[] = [];
    const count = await Effect.runPromise(
      synchronizeRepositoryHistory(
        git,
        clone,
        {
          _tag: "SynchronizeRepositoryHistory",
          repositoryId,
          requestId,
          priority: "visible",
        },
        (batch) =>
          Effect.sync(() => {
            batches.push(batch);
          }),
      ),
    );
    expect(count).toBe(2);
    expect(batches.flatMap((batch) => batch.commits).at(-1)?.parents).toEqual([
      oids[2],
    ]);
    const changed = vi.fn();
    close = (
      await Effect.runPromise(
        createLocalRepositoryWatcher().watch(join(clone, ".git"), changed),
      )
    ).close;
    await command(clone, "fetch", "--deepen=1");
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    const deepened = await Effect.runPromise(
      readRepositoryHistorySnapshot(git, clone),
    );
    expect(deepened.rootOids).toEqual(snapshot.rootOids);
    expect(deepened.shallowOids).toEqual([oids[2]]);
    expect(deepened.id).not.toBe(snapshot.id);
    const previousBasis = {
      _tag: "Complete" as const,
      commitCount: count,
      objectFormat: snapshot.objectFormat,
      rootOids: snapshot.rootOids,
      snapshotId: snapshot.id,
      shallowOids: snapshot.shallowOids ?? [],
    };
    await expect(
      Effect.runPromise(
        synchronizeRepositoryHistory(
          git,
          clone,
          {
            _tag: "SynchronizeRepositoryHistory",
            repositoryId,
            requestId,
            priority: "visible",
            basis: previousBasis,
          },
          () => Effect.void,
        ),
      ),
    ).rejects.toMatchObject({ failure: { _tag: "SnapshotInvalidated" } });
    const rebuilt: RepositoryHistoryBatch[] = [];
    expect(
      await Effect.runPromise(
        synchronizeRepositoryHistory(
          git,
          clone,
          {
            _tag: "SynchronizeRepositoryHistory",
            repositoryId,
            requestId,
            priority: "visible",
          },
          (batch) =>
            Effect.sync(() => {
              rebuilt.push(batch);
            }),
        ),
      ),
    ).toBe(3);
    expect(
      rebuilt.flatMap((batch) => batch.commits).map((commit) => commit.oid),
    ).toEqual(oids.slice(0, 3));
    expect(rebuilt.flatMap((batch) => batch.commits).at(-1)?.parents).toEqual([
      oids[3],
    ]);
    expect(await command(clone, "rev-parse", "--is-shallow-repository")).toBe(
      "true",
    );
  } finally {
    close?.();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

async function command(directory: string, ...args: string[]) {
  return (
    await exec("git", [
      "-C",
      directory,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      ...args,
    ])
  ).stdout.trim();
}
