import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import type { WorktreeLocations } from "#server/repository/repository-access.ts";
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
  locations: WorktreeLocations,
): RepositoryCoordination {
  const withLock = createKeyedLock();
  const directories = (directory: string) =>
    locations.read(directory).catch((error: unknown) => {
      throw isGitFailed(error)
        ? repositoryRejected("GitFailed", error.detail)
        : error;
    });
  const forgetOnError = async <Value>(
    directory: string,
    operation: () => Promise<Value>,
  ) => {
    try {
      return await operation();
    } catch (error) {
      locations.forget(directory);
      throw error;
    }
  };
  return {
    run: (directory, policy, operation) =>
      forgetOnError(directory, async () => {
        const { refs, worktree } = policy.locks;
        const paths = await directories(directory);
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
        readRepositoryOperation(git, directory, await directories(directory)),
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
