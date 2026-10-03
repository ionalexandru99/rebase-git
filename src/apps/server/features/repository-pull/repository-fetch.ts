import { Cause, Effect, Fiber, Option, Semaphore } from "effect";
import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type FetchFailed,
  type RepositoryFetchSetting,
  type RepositoryFetchStatus,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { CommandProgress } from "#server/features/command-progress/command-progress.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

const defaultIntervalSeconds = 300;
const maximumFetchedRepositories = 32;
const settingKey = "rebase.autoFetchIntervalSeconds";

interface FetchedRepository {
  readonly path: string;
  readonly repositoryIds: Set<string>;
  setting: RepositoryFetchSetting;
  failure?: FetchFailed;
  fetching?: Fiber.Fiber<FetchFailed | undefined> | undefined;
  schedule?: Fiber.Fiber<void> | undefined;
}

export type RepositoryFetch = Effect.Success<
  ReturnType<typeof acquireRepositoryFetch>
>;

export type AfterFetch = (
  directory: string,
  repositoryIds: readonly string[],
) => Effect.Effect<void>;

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
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const mutex = yield* Semaphore.make(1);
    const repositories = new Map<string, FetchedRepository>();

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

    const schedule = (repository: FetchedRepository): Effect.Effect<void> =>
      Effect.gen(function* () {
        const previous = repository.schedule;
        repository.schedule = undefined;
        if (previous !== undefined) yield* Fiber.interrupt(previous);
        if (
          repository.fetching !== undefined ||
          repository.setting._tag === "Disabled"
        )
          return;
        const seconds =
          repository.setting._tag === "Interval"
            ? repository.setting.seconds
            : defaultIntervalSeconds;
        repository.schedule = yield* Effect.sleep(seconds * 1_000).pipe(
          Effect.andThen(tick(repository)),
          Effect.forkIn(scope),
        );
      });

    const tick = (repository: FetchedRepository) =>
      Effect.gen(function* () {
        repository.schedule = undefined;
        if (events.listening()) yield* begin(repository);
        else yield* schedule(repository);
      }).pipe(Semaphore.withPermit(mutex));

    const begin = (
      repository: FetchedRepository,
    ): Effect.Effect<Fiber.Fiber<FetchFailed | undefined>> =>
      Effect.gen(function* () {
        if (repository.fetching !== undefined) return repository.fetching;
        const previous = repository.schedule;
        repository.schedule = undefined;
        if (previous !== undefined) yield* Fiber.interrupt(previous);
        const fetching = yield* runFetch(
          git,
          coordination,
          repository.path,
          progress.reporter(
            repository.repositoryIds,
            RepositoryPullApi.fetch._tag,
          ),
        ).pipe(
          Effect.tap((failure) =>
            Effect.gen(function* () {
              repository.fetching = undefined;
              if (failure === undefined) delete repository.failure;
              else repository.failure = failure;
              publish(repository);
              yield* schedule(repository);
              if (failure === undefined)
                yield* afterFetch(repository.path, [
                  ...repository.repositoryIds,
                ]).pipe(Effect.forkIn(scope));
            }).pipe(Semaphore.withPermit(mutex)),
          ),
          Effect.forkIn(scope),
        );
        repository.fetching = fetching;
        publish(repository);
        return fetching;
      });

    const register = (repositoryId: string) =>
      Effect.gen(function* () {
        const entry = yield* access.repository(repositoryId);
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
          setting: yield* readFetchSetting(git, entry.path),
        };
        repositories.set(key, repository);
        yield* evictOldest;
        if (repository.setting._tag !== "Disabled") yield* begin(repository);
        return repository;
      }).pipe(Semaphore.withPermit(mutex));

    const evictOldest = Effect.suspend(() => {
      const oldest = repositories.entries().next().value;
      if (
        repositories.size <= maximumFetchedRepositories ||
        oldest === undefined
      )
        return Effect.void;
      repositories.delete(oldest[0]);
      const { schedule: scheduled, fetching } = oldest[1];
      return Effect.all([
        scheduled === undefined ? Effect.void : Fiber.interrupt(scheduled),
        fetching === undefined ? Effect.void : Fiber.interrupt(fetching),
      ]);
    });

    return {
      status: (repositoryId: string) =>
        register(repositoryId).pipe(Effect.map(status)),
      fetch: (repositoryId: string) =>
        Effect.gen(function* () {
          const repository = yield* register(repositoryId);
          const fetching = yield* begin(repository).pipe(
            Semaphore.withPermit(mutex),
          );
          const failure = yield* Fiber.join(fetching);
          if (failure !== undefined) return yield* Effect.fail(failure);
          return status(repository);
        }),
      configure: (repositoryId: string, setting: RepositoryFetchSetting) =>
        Effect.gen(function* () {
          const repository = yield* register(repositoryId);
          return yield* Effect.gen(function* () {
            yield* writeFetchSetting(git, repository.path, setting);
            repository.setting = setting;
            yield* schedule(repository);
            publish(repository);
            return status(repository);
          }).pipe(Semaphore.withPermit(mutex));
        }),
    };
  });
}

function runFetch(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  path: string,
  report: (output: string) => void,
) {
  return coordination
    .run(
      path,
      {
        name: "fetch",
        locks: { refs: "ifAvailable" },
        duringOperation: "proceed",
      },
      runRepositoryGit(git, path, ["fetch", "--progress"], {
        timeoutMilliseconds: 120_000,
        progress: report,
      }),
    )
    .pipe(
      Effect.as<FetchFailed | undefined>(undefined),
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause))
          return Effect.failCause(Cause.interrupt());
        const error = Cause.findErrorOption(cause);
        return Effect.succeed<FetchFailed>({
          _tag: "FetchFailed",
          reason:
            Option.isSome(error) && error.value._tag === "GitFailed"
              ? error.value.reason
              : "Failed",
        });
      }),
    );
}

function readFetchSetting(git: GitCommandRunner, path: string) {
  return runRepositoryGit(
    git,
    path,
    ["config", "--local", "--get", settingKey],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.map((output): RepositoryFetchSetting => {
      const value = output.trim();
      const seconds = Number(value);
      return value === "0"
        ? { _tag: "Disabled" }
        : Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400
          ? { _tag: "Interval", seconds }
          : { _tag: "Inherit" };
    }),
    Effect.mapError(settingsUnavailable),
  );
}

function writeFetchSetting(
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
  return runRepositoryGit(git, path, [
    "config",
    "--local",
    settingKey,
    value,
  ]).pipe(Effect.asVoid, Effect.mapError(settingsUnavailable));
}

function settingsUnavailable(): RepositoryRejected {
  return repositoryRejected(
    "GitFailed",
    "Could not access repository fetch settings.",
  );
}
