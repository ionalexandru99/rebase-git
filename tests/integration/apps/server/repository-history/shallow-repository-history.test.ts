import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RepositoryHistoryBatch } from "@rebase/contracts";
import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { readObjectFormat } from "#server/features/repository-history/git/read-object-format";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";
import { readRepositoryHistorySnapshot } from "#server/features/repository-history/git/read-repository-history-snapshot";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";
import {
  cloneRepository,
  createRepository,
  git as runGit,
} from "#tests-support/git";
import { waitForObservation } from "#tests-support/observation";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

it("preserves true shallow parents and invalidates the old basis when external deepening leaves refs unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "rebase shallow "));
  const source = join(root, "source");
  const clone = join(root, "clone");
  const git = createLocalGitCommandRunner();
  let close: (() => void) | undefined;
  try {
    await createRepository(source, { commits: [] });
    for (let index = 0; index < 4; index += 1)
      await runGit(source, "commit", "--allow-empty", "-m", `commit ${index}`);
    await cloneRepository(pathToFileURL(source).href, clone, "--depth=2");
    const oids = (await runGit(source, "rev-list", "HEAD")).split("\n");
    const snapshot = await Effect.runPromise(
      readRepositoryHistorySnapshot(git, clone, readObjectFormat(git, clone)),
    );
    expect(snapshot.shallowOids).toEqual([oids[1]]);
    const page = await Effect.runPromise(
      readRepositoryHistory(
        git,
        clone,
        {
          _tag: "ReadRepositoryHistory",
          repositoryId,
          requestId,
          limit: 100,
          order: "topological",
          roots: snapshot.refTargets.filter((ref) => ref.type === "branch"),
        },
        readObjectFormat(git, clone),
      ),
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
        readObjectFormat(git, clone),
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
    await runGit(clone, "fetch", "--deepen=1");
    await waitForObservation(() => expect(changed).toHaveBeenCalled());
    const deepened = await Effect.runPromise(
      readRepositoryHistorySnapshot(git, clone, readObjectFormat(git, clone)),
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
          readObjectFormat(git, clone),
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
          readObjectFormat(git, clone),
        ),
      ),
    ).toBe(3);
    expect(
      rebuilt.flatMap((batch) => batch.commits).map((commit) => commit.oid),
    ).toEqual(oids.slice(0, 3));
    expect(rebuilt.flatMap((batch) => batch.commits).at(-1)?.parents).toEqual([
      oids[3],
    ]);
    expect(await runGit(clone, "rev-parse", "--is-shallow-repository")).toBe(
      "true",
    );
  } finally {
    close?.();
    await removeTemporaryDirectory(root);
  }
});
