import { homedir } from "node:os";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  FetchPrune,
  FetchPruneFailed,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
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
  const server = async () =>
    (await readPrune(git, homedir(), ["--global"])) ?? pruneByDefault;
  const repository = async (path: string): Promise<FetchPrune> => {
    const repository = await readPrune(git, path, ["--local"]);
    return { repository, server: await server() };
  };
  const inRepository = async <Success>(
    repositoryId: string,
    run: (path: string) => Promise<Success>,
  ) => {
    const { path } = await access.repository(repositoryId);
    try {
      return await run(path);
    } catch (error) {
      throw isGitFailed(error)
        ? repositoryRejected("GitFailed", error.detail)
        : error;
    }
  };
  const failingWithPrune = async <Success>(run: () => Promise<Success>) => {
    try {
      return await run();
    } catch (error) {
      throw isGitFailed(error) ? pruneFailed(error.detail) : error;
    }
  };

  return {
    server: () => failingWithPrune(server),
    saveServer: (prune: boolean) =>
      failingWithPrune(async () => {
        await writePrune(git, homedir(), "--global", prune);
        return server();
      }),
    repository: (repositoryId: string) =>
      inRepository(repositoryId, repository),
    saveRepository: (repositoryId: string, prune: boolean | null) =>
      inRepository(repositoryId, async (path) => {
        await writePrune(git, path, "--local", prune);
        return repository(path);
      }),
  };
}

export async function defaultPruneArguments(
  git: GitCommandRunner,
  path: string,
) {
  const prune = await readPrune(git, path, []);
  return prune === null ? ["-c", `${key}=${pruneByDefault}`] : [];
}

async function readPrune(
  git: GitCommandRunner,
  directory: string,
  scope: readonly ConfigScope[],
) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["config", ...scope, "--includes", "--type=bool", "--get", key],
    { exitCodes: [0, 1] },
  );
  const value = output.trim();
  return value === "" ? null : value === "true";
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

function pruneFailed(detail: string): FetchPruneFailed {
  return { _tag: "FetchPruneFailed", detail: detail.slice(0, 2_048) };
}
