import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type FetchFailed,
  type RepositoryFetchSetting,
  type RepositoryFetchStatus,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import { inRequest } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { CommandProgress } from "#server/features/command-progress/command-progress.ts";
import { defaultPruneArguments } from "#server/features/repository-pull/fetch-prune.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

const defaultIntervalSeconds = 300;
const maximumFetchedRepositories = 32;
const settingKey = "rebase.autoFetchIntervalSeconds";

interface FetchedRepository {
  readonly path: string;
  readonly repositoryIds: Set<string>;
  readonly stopped: AbortController;
  setting: RepositoryFetchSetting;
  failure?: FetchFailed;
  fetching?: Promise<FetchFailed | undefined> | undefined;
  timer?: NodeJS.Timeout | undefined;
}

export type RepositoryFetch = ReturnType<typeof acquireRepositoryFetch>;

export type AfterFetch = (
  directory: string,
  repositoryIds: readonly string[],
) => Promise<void>;

export function acquireRepositoryFetch({
  access,
  afterFetch,
  coordination,
  events,
  git,
  progress,
}: {
  readonly access: RepositoryAccess;
  readonly afterFetch: AfterFetch;
  readonly coordination: RepositoryCoordination;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
  readonly progress: CommandProgress;
}) {
  const withLock = createLock();
  const repositories = new Map<string, FetchedRepository>();
  let closed = false;

  const status = (repository: FetchedRepository): RepositoryFetchStatus => ({
    fetching: repository.fetching !== undefined,
    defaultIntervalSeconds,
    setting: repository.setting,
    ...(repository.failure === undefined
      ? {}
      : { failure: repository.failure }),
  });
  const publish = (repository: FetchedRepository) =>
    events.publishChanged([...repository.repositoryIds], "Fetch");

  const schedule = (repository: FetchedRepository) => {
    clearTimeout(repository.timer);
    repository.timer = undefined;
    if (
      closed ||
      repository.stopped.signal.aborted ||
      repository.fetching !== undefined ||
      repository.setting._tag === "Disabled"
    )
      return;
    const seconds =
      repository.setting._tag === "Interval"
        ? repository.setting.seconds
        : defaultIntervalSeconds;
    repository.timer = setTimeout(() => void tick(repository), seconds * 1_000);
  };

  const tick = (repository: FetchedRepository) =>
    withLock(async () => {
      repository.timer = undefined;
      if (repository.stopped.signal.aborted) return;
      if (events.listening()) begin(repository);
      else schedule(repository);
    });

  const begin = (repository: FetchedRepository) => {
    if (repository.fetching !== undefined) return repository.fetching;
    clearTimeout(repository.timer);
    repository.timer = undefined;
    const signal = repository.stopped.signal;
    const fetching = inRequest(
      {
        procedure: RepositoryPullApi.fetch._tag,
        signal,
        ...firstRepositoryId(repository),
      },
      () =>
        runFetch(
          git,
          coordination,
          repository.path,
          progress.reporter(
            repository.repositoryIds,
            RepositoryPullApi.fetch._tag,
          ),
          signal,
        ).then((failure) =>
          withLock(async () => {
            repository.fetching = undefined;
            if (failure === undefined) delete repository.failure;
            else repository.failure = failure;
            publish(repository);
            schedule(repository);
            if (failure === undefined && !signal.aborted)
              void afterFetch(repository.path, [
                ...repository.repositoryIds,
              ]).catch(() => undefined);
            return failure;
          }),
        ),
    );
    fetching.catch(() => undefined);
    repository.fetching = fetching;
    publish(repository);
    return fetching;
  };

  const register = (repositoryId: string) =>
    withLock(async () => {
      const entry = await access.repository(repositoryId);
      const key = entry.logicalRepositoryId ?? entry.id;
      const known = repositories.get(key);
      if (known !== undefined) {
        known.repositoryIds.add(repositoryId);
        repositories.delete(key);
        repositories.set(key, known);
        return known;
      }
      const repository: FetchedRepository = {
        path: entry.path,
        repositoryIds: new Set([repositoryId]),
        stopped: new AbortController(),
        setting: await readFetchSetting(git, entry.path),
      };
      repositories.set(key, repository);
      evictOldest();
      if (repository.setting._tag !== "Disabled") begin(repository);
      return repository;
    });

  const stop = (repository: FetchedRepository) => {
    clearTimeout(repository.timer);
    repository.timer = undefined;
    repository.stopped.abort();
  };

  const evictOldest = () => {
    const oldest = repositories.entries().next().value;
    if (repositories.size <= maximumFetchedRepositories || oldest === undefined)
      return;
    repositories.delete(oldest[0]);
    stop(oldest[1]);
  };

  return {
    status: async (repositoryId: string) =>
      status(await register(repositoryId)),
    fetch: async (repositoryId: string) => {
      const repository = await register(repositoryId);
      const { fetching } = await withLock(async () => ({
        fetching: begin(repository),
      }));
      const failure = await fetching;
      if (failure !== undefined) throw failure;
      return status(repository);
    },
    configure: async (
      repositoryId: string,
      setting: RepositoryFetchSetting,
    ) => {
      const repository = await register(repositoryId);
      return withLock(async () => {
        await writeFetchSetting(git, repository.path, setting);
        repository.setting = setting;
        schedule(repository);
        publish(repository);
        return status(repository);
      });
    },
    close: () => {
      closed = true;
      for (const repository of repositories.values()) stop(repository);
      repositories.clear();
    },
  };
}

function firstRepositoryId(repository: FetchedRepository) {
  const [repositoryId] = repository.repositoryIds;
  return repositoryId === undefined ? {} : { repositoryId };
}

function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <Value>(run: () => Promise<Value>) => {
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
}

async function runFetch(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  path: string,
  report: (output: string) => void,
  signal: AbortSignal,
): Promise<FetchFailed | undefined> {
  try {
    await coordination.run(
      path,
      {
        name: "fetch",
        locks: { refs: "wait" },
        duringOperation: "proceed",
      },
      async () =>
        runRepositoryGit(git, path, ["fetch", "--progress"], {
          globalArguments: await defaultPruneArguments(git, path),
          timeoutMilliseconds: 120_000,
          progress: report,
          signal,
        }),
    );
    return undefined;
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      _tag: "FetchFailed",
      reason: isGitFailed(error) ? error.reason : "Failed",
    };
  }
}

async function readFetchSetting(
  git: GitCommandRunner,
  path: string,
): Promise<RepositoryFetchSetting> {
  let output: string;
  try {
    output = await runRepositoryGit(
      git,
      path,
      ["config", "--local", "--get", settingKey],
      { exitCodes: [0, 1] },
    );
  } catch (error) {
    throw isGitFailed(error) ? settingsUnavailable() : error;
  }
  const value = output.trim();
  const seconds = Number(value);
  return value === "0"
    ? { _tag: "Disabled" }
    : Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400
      ? { _tag: "Interval", seconds }
      : { _tag: "Inherit" };
}

async function writeFetchSetting(
  git: GitCommandRunner,
  path: string,
  setting: RepositoryFetchSetting,
) {
  const value =
    setting._tag === "Disabled"
      ? "0"
      : setting._tag === "Interval"
        ? String(setting.seconds)
        : "inherit";
  try {
    await runRepositoryGit(git, path, ["config", "--local", settingKey, value]);
  } catch (error) {
    throw isGitFailed(error) ? settingsUnavailable() : error;
  }
}

function settingsUnavailable(): RepositoryRejected {
  return repositoryRejected(
    "GitFailed",
    "Could not access repository fetch settings.",
  );
}
