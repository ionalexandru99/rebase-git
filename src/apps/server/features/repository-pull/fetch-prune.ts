import { homedir } from "node:os";
import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  FetchPrune,
  FetchPruneFailed,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const key = "fetch.prune";
const pruneByDefault = true;

type ConfigScope = "--global" | "--local";

export type FetchPrunes = ReturnType<typeof createFetchPrunes>;

export function createFetchPrunes(
  git: GitCommandRunner,
  access: RepositoryAccess,
) {
  const server = readPrune(git, homedir(), ["--global"]).pipe(
    Effect.map((prune) => prune ?? pruneByDefault),
  );
  const repository = (path: string) =>
    Effect.all({
      repository: readPrune(git, path, ["--local"]),
      server,
    }) satisfies Effect.Effect<FetchPrune, GitFailed>;
  const inRepository = <Success>(
    repositoryId: string,
    run: (path: string) => Effect.Effect<Success, GitFailed>,
  ) =>
    access.repository(repositoryId).pipe(
      Effect.flatMap(({ path }) => run(path)),
      Effect.catchTag("GitFailed", ({ detail }) =>
        Effect.fail(repositoryRejected("GitFailed", detail)),
      ),
    );

  return {
    server: server.pipe(Effect.mapError(pruneFailed)),
    saveServer: (prune: boolean) =>
      writePrune(git, homedir(), "--global", prune).pipe(
        Effect.andThen(server),
        Effect.mapError(pruneFailed),
      ),
    repository: (repositoryId: string) =>
      inRepository(repositoryId, repository),
    saveRepository: (repositoryId: string, prune: boolean | null) =>
      inRepository(repositoryId, (path) =>
        writePrune(git, path, "--local", prune).pipe(
          Effect.andThen(repository(path)),
        ),
      ),
  };
}

export function fetchPruneArgument(git: GitCommandRunner, path: string) {
  return readPrune(git, path, []).pipe(
    Effect.map((prune) =>
      (prune ?? pruneByDefault) ? "--prune" : "--no-prune",
    ),
  );
}

function readPrune(
  git: GitCommandRunner,
  directory: string,
  scope: readonly ConfigScope[],
) {
  return runRepositoryGit(
    git,
    directory,
    ["config", ...scope, "--type=bool", "--get", key],
    {
      exitCodes: [0, 1],
    },
  ).pipe(
    Effect.map((output) => {
      const value = output.trim();
      return value === "" ? null : value === "true";
    }),
  );
}

function writePrune(
  git: GitCommandRunner,
  directory: string,
  scope: ConfigScope,
  prune: boolean | null,
) {
  return runRepositoryGit(
    git,
    directory,
    prune === null
      ? ["config", scope, "--unset-all", key]
      : ["config", scope, "--replace-all", key, String(prune)],
    { exitCodes: prune === null ? [0, 5] : [0] },
  );
}

function pruneFailed({ detail }: GitFailed): FetchPruneFailed {
  return { _tag: "FetchPruneFailed", detail: detail.slice(0, 2_048) };
}
