import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RepositoryCatalogEntry,
  RepositoryChangeKind,
} from "@rebase/contracts";
import { Effect, Queue } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, expect, it } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import type { RepositoryWatcher } from "#server/domain/repository-watcher.contract";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { createRepository } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

it("publishes a change without waiting and coalesces changes that arrive during a publish", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rebase change publisher ")),
  );
  directories.push(root);
  const first = repository("00000000-0000-4000-8000-000000000001", root);
  const second = repository("00000000-0000-4000-8000-000000000002", root);
  await createRepository(first.path);
  await createRepository(second.path);
  const listeners: Array<(kind: RepositoryChangeKind) => void> = [];
  const watcher: RepositoryWatcher = {
    watch: (_directory, onChange) =>
      Effect.sync(() => {
        listeners.push(onChange);
        return { close: () => {} };
      }),
  };
  const change = (index: number, kind: RepositoryChangeKind) =>
    listeners[index]?.(kind);

  await Effect.runPromise(
    Effect.gen(function* () {
      const events = createEnvironmentEventPublisher();
      const published = yield* Queue.unbounded<Published>();
      let duringPublish = () => {
        change(0, "Index");
        change(1, "Refs");
        change(0, "Refs");
      };
      events.subscribe((sequence, repositoryIds, kind) => {
        Queue.offerUnsafe(published, { sequence, repositoryIds, kind });
        const burst = duringPublish;
        duringPublish = () => {};
        burst();
      });
      const changes = yield* acquireRepositoryChangePublisher(
        createLocalGitCommandRunner(),
        watcher,
        events,
      );
      yield* changes.watch(first);
      yield* changes.watch(second);

      change(0, "Refs");
      expect(yield* Queue.take(published)).toEqual({
        sequence: 1,
        repositoryIds: [first.id],
        kind: "Refs",
      });
      expect(yield* Queue.take(published)).toEqual({
        sequence: 2,
        repositoryIds: [first.id, second.id],
        kind: "Refs",
      });
      change(1, "Index");
      expect(yield* Queue.take(published)).toEqual({
        sequence: 3,
        repositoryIds: [second.id],
        kind: "Index",
      });
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});

interface Published {
  readonly sequence: number;
  readonly repositoryIds: readonly string[] | undefined;
  readonly kind: RepositoryChangeKind | undefined;
}

function repository(id: string, root: string): RepositoryCatalogEntry {
  return {
    id,
    path: join(root, id),
    name: id,
    addedAt: "2026-09-26T00:00:00.000Z",
    lastOpenedAt: "2026-09-26T00:00:00.000Z",
  };
}
