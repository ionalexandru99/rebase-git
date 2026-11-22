import { realpath } from "node:fs/promises";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  cacheByGitEntry,
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  type GitDirectories,
  readRepositoryOperation,
} from "#server/repository/repository-operation.ts";

type RepositoryLockAcquisition = "wait";

export interface RepositoryWritePolicy {
  readonly name: string;
  readonly locks: {
    readonly refs?: RepositoryLockAcquisition;
    readonly worktree?: RepositoryLockAcquisition;
  };
  readonly duringOperation:
    | "proceed"
    | "block"
    | { readonly allowWhen: (operation: RepositoryOperation) => boolean };
}

export const atRebaseEditStop: RepositoryWritePolicy["duringOperation"] = {
  allowWhen: (operation) =>
    operation.kind === "rebase" && operation.phase === "edit",
};

export interface RepositoryCoordination {
  readonly run: <Value>(
    directory: string,
    policy: RepositoryWritePolicy,
    operation: () => Promise<Value>,
  ) => Promise<Value>;
  readonly operation: (directory: string) => Promise<RepositoryOperation>;
}

export function createRepositoryCoordination(
  git: GitCommandRunner,
): RepositoryCoordination {
  const withLock = createKeyedLock();
  const directories = cacheByGitEntry((directory) =>
    resolveGitDirectories(git, directory),
  );
  const forgetOnError = async <Value>(
    directory: string,
    operation: () => Promise<Value>,
  ) => {
    try {
      return await operation();
    } catch (error) {
      directories.forget(directory);
      throw error;
    }
  };
  return {
    run: (directory, policy, operation) =>
      forgetOnError(directory, async () => {
        const { refs, worktree } = policy.locks;
        const paths = await directories.read(directory);
        const guarded = async () => {
          await requireCompatibleWrite(git, directory, paths, policy);
          return operation();
        };
        const inWorktree =
          worktree === undefined
            ? guarded
            : () => withLock(`worktree:${paths.gitDirectory}`, guarded);
        return refs === undefined
          ? inWorktree()
          : withLock(`refs:${paths.commonDirectory}`, inWorktree);
      }),
    operation: (directory) =>
      forgetOnError(directory, async () =>
        readRepositoryOperation(
          git,
          directory,
          await directories.read(directory),
        ),
      ),
  };
}

function createKeyedLock() {
  const tails = new Map<string, Promise<void>>();
  return async <Value>(key: string, operation: () => Promise<Value>) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => tail);
    tails.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(key) === queued) tails.delete(key);
    }
  };
}

async function requireCompatibleWrite(
  git: GitCommandRunner,
  directory: string,
  paths: GitDirectories,
  { name, duringOperation }: RepositoryWritePolicy,
) {
  if (duringOperation === "proceed") return;
  const state = await readRepositoryOperation(git, directory, paths);
  if (state.lock !== null)
    throw repositoryRejected("Busy", `Git lock exists: ${state.lock}.`);
  if (
    state.kind === "idle" ||
    (duringOperation !== "block" && duringOperation.allowWhen(state))
  )
    return;
  throw repositoryRejected(
    "Incompatible",
    `Cannot ${name} while ${state.kind === "unknown" ? "an unrecognized Git operation is" : `${state.kind} is`} in progress.`,
  );
}

async function resolveGitDirectories(
  git: GitCommandRunner,
  directory: string,
): Promise<GitDirectories> {
  let output: string;
  try {
    output = await runRepositoryGit(git, directory, [
      "rev-parse",
      "--path-format=absolute",
      "--absolute-git-dir",
      "--git-common-dir",
    ]);
  } catch (error) {
    throw isGitFailed(error)
      ? repositoryRejected("GitFailed", error.detail)
      : error;
  }
  const [gitDirectory = "", commonDirectory = ""] = output
    .trimEnd()
    .split("\n");
  try {
    return {
      gitDirectory: await realpath(gitDirectory),
      commonDirectory: await realpath(commonDirectory),
    };
  } catch {
    throw repositoryRejected(
      "GitFailed",
      "Could not resolve the worktree's Git directories.",
    );
  }
}
