import { Effect } from "effect";
import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  BranchCommitSummary,
  BranchDeletion,
  DeleteRepositoryBranches,
  RepositoryBranchesDeleted,
  RepositoryBranchesOperationFailure,
  UnmergedBranch,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  branchRef,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const listedCommits = 20;
const unmergedChecks = 8;
const pushCommand = { literalPathspecs: false, timeoutMilliseconds: 120_000 };

type LocalTarget = NonNullable<BranchDeletion["local"]>;
type RemoteTarget = NonNullable<BranchDeletion["remote"]>;
type RefTargets = ReadonlyMap<string, string>;

export function deleteBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  { branches, force, worktreePath }: DeleteRepositoryBranches,
): Effect.Effect<
  RepositoryBranchesDeleted,
  RepositoryBranchesOperationFailure | RepositoryRejected | GitFailed
> {
  return Effect.gen(function* () {
    const refs = yield* readRefTargets(git, worktreePath);
    const worktrees = yield* access.worktrees(worktreePath);
    const problem = branches
      .map((branch) => deletionProblem(branch, refs, worktrees))
      .find(isDefined);
    if (problem !== undefined) return yield* Effect.fail(problem);
    const unmerged = force
      ? []
      : yield* unmergedBranches(git, worktreePath, branches, refs);
    const deleted = branches.filter(
      (branch) => !unmerged.some((entry) => entry.branch === branch),
    );
    yield* deleteRemotes(
      git,
      worktreePath,
      deleted.flatMap(({ remote }) => (remote === undefined ? [] : [remote])),
    );
    yield* deleteLocals(
      git,
      worktreePath,
      deleted.flatMap(({ local }) => (local === undefined ? [] : [local])),
    );
    return { deleted, unmerged };
  });
}

function readRefTargets(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ],
    refCommand,
  ).pipe(
    Effect.map(
      (output): RefTargets =>
        new Map(
          output
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => {
              const [ref = "", target = ""] = line.split("\0");
              return [ref, target];
            }),
        ),
    ),
  );
}

function deletionProblem(
  { local, remote }: BranchDeletion,
  refs: RefTargets,
  worktrees: readonly RepositoryWorktree[],
): RepositoryBranchesOperationFailure | undefined {
  const holder =
    local === undefined ? undefined : worktreeHolding(worktrees, local.name);
  if (local !== undefined && holder !== undefined)
    return {
      _tag: "BranchCheckedOutElsewhere",
      name: local.name,
      worktreePath: holder.path,
    };
  return (
    (local === undefined
      ? undefined
      : targetProblem(refs, branchRef(local.name), local.name, local.target)) ??
    (remote === undefined
      ? undefined
      : targetProblem(
          refs,
          remoteRef(remote),
          remoteLabel(remote),
          remote.target,
        ))
  );
}

function targetProblem(
  refs: RefTargets,
  ref: string,
  name: string,
  expected: string,
): RepositoryBranchesOperationFailure | undefined {
  const target = refs.get(ref);
  if (target === undefined) return { _tag: "RefMissing", name };
  return target === expected ? undefined : { _tag: "BranchMoved", name };
}

function unmergedBranches(
  git: GitCommandRunner,
  directory: string,
  branches: readonly BranchDeletion[],
  refs: RefTargets,
) {
  const deleting = new Set(branches.flatMap(deletedRefs));
  const kept = [
    ...new Set(
      [...refs]
        .filter(([ref]) => !deleting.has(ref))
        .map(([, target]) => `^${target}`),
    ),
  ];
  const onlyOn = (targets: readonly string[]) =>
    [...new Set(targets), ...kept, ""].join("\n");
  return Effect.gen(function* () {
    const lost = yield* countCommits(
      git,
      directory,
      onlyOn(branches.flatMap(targets)),
    );
    if (lost === 0) return [];
    const entries = yield* Effect.forEach(
      branches,
      (branch) =>
        unmergedBranch(git, directory, branch, onlyOn(targets(branch))),
      { concurrency: unmergedChecks },
    );
    return entries.filter(isDefined);
  });
}

function unmergedBranch(
  git: GitCommandRunner,
  directory: string,
  branch: BranchDeletion,
  revisions: string,
) {
  return Effect.all(
    {
      count: countCommits(git, directory, revisions),
      log: runRepositoryGit(
        git,
        directory,
        ["log", "--format=%H%x00%s", `--max-count=${listedCommits}`, "--stdin"],
        { ...refCommand, input: revisions },
      ),
    },
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(({ count, log }): UnmergedBranch | undefined =>
      count === 0 ? undefined : { branch, commits: parseCommits(log), count },
    ),
  );
}

function countCommits(
  git: GitCommandRunner,
  directory: string,
  revisions: string,
) {
  return runRepositoryGit(git, directory, ["rev-list", "--count", "--stdin"], {
    ...refCommand,
    input: revisions,
  }).pipe(Effect.map((output) => Number.parseInt(output.trim(), 10)));
}

function deleteRemotes(
  git: GitCommandRunner,
  directory: string,
  remotes: readonly RemoteTarget[],
) {
  return Effect.forEach(
    Map.groupBy(remotes, ({ remote }) => remote),
    ([remote, group]) =>
      runRepositoryGit(
        git,
        directory,
        [
          "push",
          ...group.map(
            ({ name, target }) =>
              `--force-with-lease=refs/heads/${name}:${target}`,
          ),
          remote,
          "--delete",
          ...group.map(({ name }) => name),
        ],
        pushCommand,
      ).pipe(
        Effect.mapError(
          (error): RepositoryBranchesOperationFailure | RepositoryRejected => {
            const rejected =
              /\[rejected\].*?(\S+) \((?:stale info|fetch first)\)/.exec(
                error.detail,
              )?.[1];
            const name = `${remote}/${rejected ?? group[0]?.name ?? ""}`;
            return isGitRejection(error) && rejected !== undefined
              ? { _tag: "BranchMoved", name }
              : branchWriteFailed(error, name);
          },
        ),
      ),
    { discard: true },
  );
}

function deleteLocals(
  git: GitCommandRunner,
  directory: string,
  locals: readonly LocalTarget[],
) {
  if (locals.length === 0) return Effect.void;
  return runRepositoryGit(git, directory, ["update-ref", "--stdin"], {
    ...refCommand,
    input: locals
      .map(({ name, target }) => `delete ${branchRef(name)} ${target}\n`)
      .join(""),
  }).pipe(
    Effect.catchIf(isGitRejection, (error) =>
      Effect.fail<RepositoryBranchesOperationFailure>({
        _tag: "BranchMoved",
        name:
          /'refs\/heads\/([^']+)'/.exec(error.detail)?.[1] ??
          locals[0]?.name ??
          "",
      }),
    ),
    Effect.andThen(
      Effect.forEach(
        locals,
        ({ name }) =>
          runRepositoryGit(
            git,
            directory,
            ["config", "--remove-section", `branch.${name}`],
            { ...refCommand, exitCodes: [0, 1, 128] },
          ),
        { discard: true },
      ),
    ),
  );
}

function deletedRefs({ local, remote }: BranchDeletion) {
  return [
    ...(local === undefined ? [] : [branchRef(local.name)]),
    ...(remote === undefined ? [] : [remoteRef(remote)]),
  ];
}

function targets({ local, remote }: BranchDeletion) {
  return [local?.target, remote?.target].filter(isDefined);
}

function remoteRef(remote: RemoteTarget) {
  return `refs/remotes/${remoteLabel(remote)}`;
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
