import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
} from "#server/adapters/local-git/git-commands.ts";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/adapters/local-git/local-repository-watcher.ts";

export interface RepositoryChangePublisher {
  readonly watch: (repository: RepositoryCatalogEntry) => Promise<void>;
  readonly restart: (repositoryId: string) => Promise<void>;
  readonly watchers: () => readonly WatchedRepository[];
  readonly close: () => void;
}

export interface WatchedRepository {
  readonly repositoryId: string;
  readonly failure?: string;
}

interface Watched {
  readonly repository: RepositoryCatalogEntry;
  handle?: RepositoryWatchHandle;
  failure?: string;
}

const maximumWatchedRepositories = 32;

export async function acquireRepositoryChangePublisher(
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
  events: EnvironmentEventPublisher,
  onWatchFailure: (repositoryId: string, detail: string) => void = () => {},
): Promise<RepositoryChangePublisher> {
  const watches = new Map<string, Watched>();
  const changed = new Map<string, RepositoryChangeKind>();
  const exclusive = createLock();
  let pending: NodeJS.Immediate | undefined;
  let closed = false;

  const publish = () => {
    pending = undefined;
    const batch = [...changed];
    changed.clear();
    for (const kind of ["Refs", "Index"] as const) {
      const repositoryIds = batch.flatMap(([repositoryId, changedKind]) =>
        changedKind === kind ? [repositoryId] : [],
      );
      if (repositoryIds.length > 0) events.publishChanged(repositoryIds, kind);
    }
  };

  const unwatch = (repositoryId: string) => {
    watches.get(repositoryId)?.handle?.close();
    watches.delete(repositoryId);
  };

  const register = (repository: RepositoryCatalogEntry, directory: string) => {
    const oldest = watches.keys().next().value;
    if (watches.size >= maximumWatchedRepositories && oldest !== undefined)
      unwatch(oldest);
    const watched: Watched = { repository };
    watches.set(repository.id, watched);
    watched.handle = watcher.watch(directory, {
      changed: (kind) => {
        if (changed.get(repository.id) !== "Refs")
          changed.set(repository.id, kind);
        pending ??= setImmediate(publish);
      },
      failed: (detail) => {
        if (watched.failure !== undefined) return;
        watched.failure = detail;
        onWatchFailure(repository.id, detail);
      },
    });
  };

  const watch = async (repository: RepositoryCatalogEntry) => {
    if (closed || watches.has(repository.id)) return;
    const directory = await readGitCommonDirectory(git, repository.path, {
      timeoutMilliseconds: 5_000,
    }).catch(() => undefined);
    if (closed || directory === undefined) return;
    register(repository, directory);
  };

  return {
    watch: (repository) => exclusive(() => watch(repository)),
    restart: (repositoryId) =>
      exclusive(async () => {
        const watched = watches.get(repositoryId);
        if (watched === undefined) return;
        unwatch(repositoryId);
        await watch(watched.repository);
      }),
    watchers: () =>
      [...watches].map(([repositoryId, { failure }]) =>
        failure === undefined ? { repositoryId } : { repositoryId, failure },
      ),
    close: () => {
      closed = true;
      clearImmediate(pending);
      for (const repositoryId of [...watches.keys()]) unwatch(repositoryId);
      changed.clear();
    },
  };
}

function createLock() {
  let tail = Promise.resolve();
  return <Value>(run: () => Promise<Value>) => {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
