import type {
  BranchCommitSummary,
  DeleteRepositoryBranch,
  RepositoryBranchDeleted,
  RepositoryBranchesOperationFailure,
  RepositoryRejected,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type {
  RepositoryAccessError,
  RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures";
import {
  branchCommand,
  branchRef,
  requireBranchTarget,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

const listedCommits = 20;
const pushCommand = { literalPathspecs: false, timeoutMilliseconds: 120_000 };

type LocalTarget = NonNullable<DeleteRepositoryBranch["local"]>;
type RemoteTarget = NonNullable<DeleteRepositoryBranch["remote"]>;

export function deleteBranch(
  git: GitCommandRunner,
  access: RepositoryAccessService,
  command: DeleteRepositoryBranch,
): Effect.Effect<
  RepositoryBranchDeleted,
  | RepositoryBranchesOperationFailure
  | RepositoryRejected
  | RepositoryAccessError
  | RepositoryGitError
> {
  const { force, local, remote, worktreePath } = command;
  return Effect.gen(function* () {
    if (local !== undefined)
      yield* requireDeletableLocal(git, access, worktreePath, local);
    if (remote !== undefined)
      yield* requireRemoteTarget(git, worktreePath, remote);
    if (!force) yield* rejectUnmergedCommits(git, worktreePath, command);
    if (remote !== undefined) yield* deleteRemote(git, worktreePath, remote);
    if (local !== undefined) yield* deleteLocal(git, worktreePath, local);
    return {
      ...(local === undefined ? {} : { local }),
      ...(remote === undefined ? {} : { remote }),
    };
  });
}

function requireDeletableLocal(
  git: GitCommandRunner,
  access: RepositoryAccessService,
  worktreePath: string,
  { name, target }: LocalTarget,
) {
  return Effect.gen(function* () {
    const holder = worktreeHolding(yield* access.worktrees(worktreePath), name);
    if (holder !== undefined)
      return yield* Effect.fail<RepositoryBranchesOperationFailure>({
        _tag: "BranchCheckedOutElsewhere",
        name,
        worktreePath: holder.path,
      });
    yield* requireBranchTarget(git, worktreePath, name, target);
  });
}

function deleteLocal(
  git: GitCommandRunner,
  directory: string,
  { name, target }: LocalTarget,
) {
  return runRepositoryGit(
    git,
    directory,
    ["update-ref", "-d", branchRef(name), target],
    branchCommand,
  ).pipe(
    Effect.catchIf(isGitRejection, () =>
      Effect.fail<RepositoryBranchesOperationFailure>({
        _tag: "BranchMoved",
        name,
      }),
    ),
    Effect.andThen(
      runRepositoryGit(
        git,
        directory,
        ["config", "--remove-section", `branch.${name}`],
        { ...branchCommand, exitCodes: [0, 1, 128] },
      ),
    ),
    Effect.asVoid,
  );
}

function requireRemoteTarget(
  git: GitCommandRunner,
  directory: string,
  remote: RemoteTarget,
) {
  const name = remoteLabel(remote);
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}^{commit}`],
    { ...branchCommand, exitCodes: [0, 1] },
  ).pipe(
    Effect.flatMap((output) => {
      const target = output.trim();
      if (target.length === 0)
        return Effect.fail<RepositoryBranchesOperationFailure>({
          _tag: "RefMissing",
          name,
        });
      return target === remote.target
        ? Effect.void
        : Effect.fail<RepositoryBranchesOperationFailure>({
            _tag: "BranchMoved",
            name,
          });
    }),
  );
}

function rejectUnmergedCommits(
  git: GitCommandRunner,
  directory: string,
  { local, remote }: DeleteRepositoryBranch,
) {
  const targets = [
    ...new Set([local?.target, remote?.target].filter(isDefined)),
  ];
  const onlyOnBranch = [
    ...targets,
    "--not",
    ...(local === undefined ? [] : [`--exclude=${local.name}`]),
    "--branches",
    ...(remote === undefined ? [] : [`--exclude=${remoteLabel(remote)}`]),
    "--remotes",
    "--tags",
  ];
  return Effect.all(
    {
      count: runRepositoryGit(
        git,
        directory,
        ["rev-list", "--count", ...onlyOnBranch],
        branchCommand,
      ),
      log: runRepositoryGit(
        git,
        directory,
        [
          "log",
          "--format=%H%x00%s",
          `--max-count=${listedCommits}`,
          ...onlyOnBranch,
        ],
        branchCommand,
      ),
    },
    { concurrency: "unbounded" },
  ).pipe(
    Effect.flatMap(({ count, log }) => {
      const unmerged = Number.parseInt(count.trim(), 10);
      return unmerged === 0
        ? Effect.void
        : Effect.fail<RepositoryBranchesOperationFailure>({
            _tag: "BranchNotMerged",
            commits: parseCommits(log),
            count: unmerged,
            name:
              local?.name ?? (remote === undefined ? "" : remoteLabel(remote)),
          });
    }),
  );
}

function deleteRemote(
  git: GitCommandRunner,
  directory: string,
  remote: RemoteTarget,
) {
  return runRepositoryGit(
    git,
    directory,
    [
      "push",
      `--force-with-lease=refs/heads/${remote.name}:${remote.target}`,
      remote.remote,
      "--delete",
      remote.name,
    ],
    pushCommand,
  ).pipe(
    Effect.asVoid,
    Effect.mapError(
      (error): RepositoryBranchesOperationFailure | RepositoryRejected =>
        isGitRejection(error) && /stale info|fetch first/i.test(error.detail)
          ? { _tag: "BranchMoved", name: remoteLabel(remote) }
          : branchWriteFailed(error, remoteLabel(remote)),
    ),
  );
}

function remoteLabel(remote: Pick<RemoteTarget, "name" | "remote">) {
  return `${remote.remote}/${remote.name}`;
}

function parseCommits(log: string): readonly BranchCommitSummary[] {
  return log
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [oid = "", subject = ""] = line.split("\0");
      return { oid, subject: subject.slice(0, 512) };
    });
}

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}
