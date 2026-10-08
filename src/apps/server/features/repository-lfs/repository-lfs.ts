import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type LargeFiles,
  type LfsLocks,
  LfsPattern,
  RepositoryLfsApi,
  type SetLock,
  type SetTracked,
} from "#contracts/repository-lfs/repository-lfs.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  downloadLargeFiles,
  type GitLfs,
  runGitLfs,
} from "#server/features/repository-lfs/git-lfs.ts";

const isPattern = Schema.is(LfsPattern);
const LockRecord = Schema.Struct({
  path: Schema.String,
  owner: Schema.optional(Schema.Struct({ name: Schema.String })),
});
const decodeLocks = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      ours: Schema.Array(LockRecord),
      theirs: Schema.Array(LockRecord),
    }),
  ),
);
const lockArguments: Readonly<Record<SetLock["action"], readonly string[]>> = {
  Lock: ["lock"],
  Unlock: ["unlock"],
  ForceUnlock: ["unlock", "--force"],
};

function readLargeFiles(lfs: GitLfs, directory: string) {
  return Effect.gen(function* () {
    const installed = yield* lfs.installed;
    const attributes = yield* Effect.promise(() =>
      readFile(join(directory, ".gitattributes"), "utf8").catch(() => ""),
    );
    return {
      installed,
      patterns: trackedPatterns(attributes),
    } satisfies LargeFiles;
  });
}

export function trackedPatterns(attributes: string) {
  return attributes
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([pattern, ...rest]) =>
        pattern !== undefined &&
        !pattern.startsWith("#") &&
        rest.includes("filter=lfs"),
    )
    .flatMap(([pattern]) =>
      pattern !== undefined && isPattern(pattern) ? [pattern] : [],
    );
}

function readLocks(git: GitCommandRunner, directory: string) {
  return runGitLfs(git, directory, ["locks", "--verify", "--json"]).pipe(
    Effect.flatMap(decodeLocks),
    Effect.map(
      ({ ours, theirs }): LfsLocks => [
        ...ours.map((lock) => readLock(lock, true)),
        ...theirs.map((lock) => readLock(lock, false)),
      ],
    ),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(
        gitFailed("Failed", "Git LFS returned locks Rebase can't read."),
      ),
    ),
  );
}

function readLock(
  lock: typeof LockRecord.Type,
  ours: boolean,
): LfsLocks[number] {
  return { path: lock.path, owner: lock.owner?.name ?? "", ours };
}

function setTracked(command: SetTracked, git: GitCommandRunner) {
  return runGitLfs(git, command.worktreePath, [
    command.tracked ? "track" : "untrack",
    command.pattern,
  ]).pipe(Effect.asVoid);
}

function setLock(command: SetLock, git: GitCommandRunner) {
  return runGitLfs(git, command.worktreePath, [
    ...lockArguments[command.action],
    "--",
    command.path,
  ]).pipe(
    Effect.asVoid,
    Effect.catchIf(
      (failure) => /Not Implemented|not supported/i.test(failure.detail),
      () =>
        Effect.fail(
          repositoryRejected(
            "Incompatible",
            "This server doesn't support file locks.",
          ),
        ),
    ),
  );
}

export function repositoryLfsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryLfsApi;
  return {
    routes: [
      query(api.read, (input) =>
        readLargeFiles(dependencies.lfs, input.worktreePath),
      ),
      query(api.locks, (input, git) => readLocks(git, input.worktreePath)),
      command(
        api.setTracked,
        {
          name: "track large files",
          locks: { worktree: "wait" },
          duringOperation: "block",
        },
        setTracked,
      ),
      command(
        api.download,
        {
          name: "download large files",
          locks: { worktree: "wait" },
          duringOperation: "block",
        },
        (input, git) =>
          downloadLargeFiles(
            git,
            input.worktreePath,
            input.paths,
            input.commits,
          ),
      ),
      command(
        api.setLock,
        { name: "lock", locks: {}, duringOperation: "proceed" },
        setLock,
      ),
    ],
  };
}
