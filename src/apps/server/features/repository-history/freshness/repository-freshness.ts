import type {
  RepositoryCatalogEntry,
  RepositoryFetchSetting,
  RepositoryFreshness,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import type { RepositoryFreshnessService } from "#server/domain/repository-freshness.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/domain/repository-watcher.contract";
import {
  readRepositoryFetchSetting,
  writeRepositoryFetchSetting,
} from "#server/features/repository-history/freshness/repository-fetch-settings";

interface WatchedRepository {
  readonly controller: AbortController;
  path: string;
  readonly subscribers: Map<(freshness: RepositoryFreshness) => void, string>;
  readonly fetchOwners: Set<(freshness: RepositoryFreshness) => void>;
  freshness: RepositoryFreshness;
  fetch?: Promise<RepositoryFreshness>;
  fetchController?: AbortController;
  manualFetchOwners: number;
  timer?: ReturnType<typeof setTimeout>;
  changeTimer?: ReturnType<typeof setTimeout>;
  watch?: RepositoryWatchHandle;
}

interface RepositorySubscriptions {
  readonly repository: Promise<WatchedRepository>;
  count: number;
}

export function acquireRepositoryFreshnessService(dependencies: {
  readonly catalog: RepositoryCatalog;
  readonly git: GitCommandRunner;
  readonly watcher: RepositoryWatcher;
  readonly defaultIntervalSeconds?: number;
}) {
  return Effect.acquireRelease(
    Effect.sync(() => createRepositoryFreshnessService(dependencies)),
    (service) => Effect.promise(service.close),
  );
}

function createRepositoryFreshnessService(dependencies: {
  readonly catalog: RepositoryCatalog;
  readonly git: GitCommandRunner;
  readonly watcher: RepositoryWatcher;
  readonly defaultIntervalSeconds?: number;
}): RepositoryFreshnessService & { readonly close: () => Promise<void> } {
  const repositories = new Map<string, RepositorySubscriptions>();
  const aliases = new Map<string, string>();
  const lifecycle = new AbortController();
  let closed = false;

  const publish = (repository: WatchedRepository) => {
    for (const subscriber of repository.subscribers.keys())
      subscriber(repository.freshness);
  };
  const completeFetch = (
    repository: WatchedRepository,
    failure: RepositoryFreshness["failure"],
  ) => {
    const { failure: previousFailure, ...freshness } = repository.freshness;
    repository.freshness = {
      ...freshness,
      fetching: false,
      stale: failure !== undefined,
      revision: freshness.revision + 1,
      ...(failure === undefined ? {} : { failure }),
    };
    publish(repository);
    return repository.freshness;
  };
  const stop = (repository: WatchedRepository) => {
    clearTimeout(repository.timer);
    clearTimeout(repository.changeTimer);
    repository.watch?.close();
    repository.controller.abort();
    repository.subscribers.clear();
  };
  const schedule = (repository: WatchedRepository) => {
    clearTimeout(repository.timer);
    if (
      repository.controller.signal.aborted ||
      repository.fetchOwners.size === 0
    )
      return;
    const setting = repository.freshness.setting;
    if (setting._tag === "Disabled") return;
    const seconds =
      setting._tag === "Interval"
        ? setting.seconds
        : repository.freshness.defaultIntervalSeconds;
    repository.timer = setTimeout(() => {
      void fetch(repository);
    }, seconds * 1_000);
    repository.timer.unref();
  };
  const fetch = (
    repository: WatchedRepository,
  ): Promise<RepositoryFreshness> => {
    if (repository.fetch !== undefined) return repository.fetch;
    clearTimeout(repository.timer);
    repository.freshness = { ...repository.freshness, fetching: true };
    repository.fetchController = new AbortController();
    publish(repository);
    repository.fetch = Effect.runPromise(
      dependencies.git
        .run({
          directory: repository.path,
          arguments: ["fetch"],
          timeoutMilliseconds: 120_000,
        })
        .pipe(
          Effect.map((output): RepositoryFreshness["failure"] =>
            output.exitCode === 0
              ? undefined
              : { _tag: "FetchFailed", reason: "Failed" },
          ),
          Effect.catch((error) =>
            Effect.succeed({
              _tag: "FetchFailed",
              reason: error.reason,
            } as const),
          ),
        ),
      {
        signal: AbortSignal.any([
          repository.controller.signal,
          repository.fetchController.signal,
        ]),
      },
    )
      .then(
        (failure) => completeFetch(repository, failure),
        () =>
          completeFetch(repository, { _tag: "FetchFailed", reason: "Failed" }),
      )
      .finally(() => {
        delete repository.fetch;
        delete repository.fetchController;
        schedule(repository);
      });
    return repository.fetch;
  };
  const changed = (repository: WatchedRepository) => {
    if (
      repository.controller.signal.aborted ||
      repository.changeTimer !== undefined
    )
      return;
    repository.changeTimer = setTimeout(() => {
      delete repository.changeTimer;
      repository.freshness = {
        ...repository.freshness,
        revision: repository.freshness.revision + 1,
      };
      publish(repository);
    }, 50);
    repository.changeTimer.unref();
  };
  const initialize = (entry: RepositoryCatalogEntry) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const setting = yield* readRepositoryFetchSetting(
          dependencies.git,
          entry.path,
        );
        const directory = yield* dependencies.git.run({
          directory: entry.path,
          arguments: [
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ],
        });
        if (directory.exitCode !== 0 || directory.stdout.trim() === "")
          return yield* Effect.fail(missingRepository(entry.id));
        const repository: WatchedRepository = {
          controller: new AbortController(),
          path: entry.path,
          subscribers: new Map(),
          fetchOwners: new Set(),
          manualFetchOwners: 0,
          freshness: {
            fetching: false,
            stale: false,
            revision: 0,
            defaultIntervalSeconds: dependencies.defaultIntervalSeconds ?? 300,
            setting,
          },
        };
        repository.watch = yield* dependencies.watcher.watch(
          directory.stdout.trim(),
          () => changed(repository),
        );
        if (closed) stop(repository);
        return repository;
      }),
      { signal: lifecycle.signal },
    );
  const active = async (repositoryId: string) => {
    const repository = await repositories.get(
      aliases.get(repositoryId) ?? repositoryId,
    )?.repository;
    if (repository === undefined || repository.controller.signal.aborted)
      throw missingRepository(repositoryId);
    return repository;
  };

  return {
    subscribe: (repositoryId, subscriber, authorization) =>
      Effect.tryPromise({
        try: async (signal) => {
          if (closed) throw missingRepository(repositoryId);
          const entry = await Effect.runPromise(
            dependencies.catalog.find(repositoryId),
            { signal },
          );
          if (entry === undefined || closed)
            throw missingRepository(repositoryId);
          const key = entry.logicalRepositoryId ?? repositoryId;
          aliases.set(repositoryId, key);
          let pending = repositories.get(key);
          if (pending === undefined) {
            pending = { repository: initialize(entry), count: 0 };
            repositories.set(key, pending);
          }
          pending.count += 1;
          let repository: WatchedRepository;
          try {
            repository = await pending.repository;
          } catch (error) {
            if (repositories.get(key) === pending) repositories.delete(key);
            throw error;
          }
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            signal.removeEventListener("abort", release);
            pending.count -= 1;
            repository.subscribers.delete(subscriber);
            repository.fetchOwners.delete(subscriber);
            if (repository.fetchOwners.size === 0) {
              clearTimeout(repository.timer);
              if (repository.manualFetchOwners === 0)
                repository.fetchController?.abort();
            }
            const survivingPath = repository.subscribers.values().next().value;
            if (survivingPath !== undefined) repository.path = survivingPath;
            if (pending.count !== 0) return;
            if (repositories.get(key) === pending) repositories.delete(key);
            for (const [alias, logicalId] of aliases)
              if (logicalId === key) aliases.delete(alias);
            stop(repository);
          };
          if (signal.aborted || repository.controller.signal.aborted) {
            release();
            throw missingRepository(repositoryId);
          }
          if (repository.subscribers.size === 0) repository.path = entry.path;
          repository.subscribers.set(subscriber, entry.path);
          if (authorization?.automaticFetch)
            repository.fetchOwners.add(subscriber);
          signal.addEventListener("abort", release, { once: true });
          subscriber(repository.freshness);
          if (
            authorization?.automaticFetch &&
            repository.fetchOwners.size === 1 &&
            repository.freshness.setting._tag !== "Disabled"
          )
            void fetch(repository);
          return release;
        },
        catch: historyError,
      }),
    fetch: (repositoryId) =>
      Effect.tryPromise({
        try: () => active(repositoryId),
        catch: historyError,
      }).pipe(
        Effect.flatMap((repository) =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              repository.manualFetchOwners += 1;
            }),
            () =>
              Effect.tryPromise({
                try: () => fetch(repository),
                catch: historyError,
              }),
            () =>
              Effect.sync(() => {
                repository.manualFetchOwners -= 1;
                if (
                  repository.manualFetchOwners === 0 &&
                  repository.fetchOwners.size === 0
                )
                  repository.fetchController?.abort();
              }),
          ),
        ),
      ),
    configure: (repositoryId, setting: RepositoryFetchSetting) =>
      Effect.tryPromise({
        try: async () => {
          const repository = await active(repositoryId);
          await Effect.runPromise(
            writeRepositoryFetchSetting(
              dependencies.git,
              repository.path,
              setting,
            ),
            { signal: repository.controller.signal },
          );
          repository.freshness = { ...repository.freshness, setting };
          publish(repository);
          if (repository.fetch === undefined) schedule(repository);
          return repository.freshness;
        },
        catch: historyError,
      }),
    close: async () => {
      closed = true;
      lifecycle.abort();
      await Promise.all(
        [...repositories.values()].map(({ repository }) =>
          repository.then(
            async (state) => {
              stop(state);
              await state.fetch;
            },
            () => {},
          ),
        ),
      );
      repositories.clear();
      aliases.clear();
    },
  };
}

function missingRepository(repositoryId: string) {
  return new RepositoryHistoryError({
    failure: { _tag: "RepositoryMissing", repositoryId },
  });
}

function historyError(cause: unknown) {
  return cause instanceof RepositoryHistoryError
    ? cause
    : new RepositoryHistoryError({
        cause,
        failure: { _tag: "GitFailed", reason: "Failed" },
      });
}
