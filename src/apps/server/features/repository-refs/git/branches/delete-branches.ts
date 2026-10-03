import { Array as Arrays, Effect, Result } from "effect";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
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
  runRepositoryGitOutput,
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
const pushedPerCommand = 100;
const pushCommand = { literalPathspecs: false, timeoutMilliseconds: 120_000 };

type LocalTarget = NonNullable<BranchDeletion["local"]>;
type RemoteTarget = NonNullable<BranchDeletion["remote"]>;
type RefTargets = ReadonlyMap<string, string>;

interface PushedRef {
  readonly flag: string;
  readonly ref: string;
  readonly summary: string;
}

interface PushPasses {
  readonly gone: readonly RemoteTarget[];
  readonly pushed: readonly PushedRef[];
  readonly stderr: string;
}

export function deleteBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  {
    branches,
    force,
    worktreePath,
  }: Omit<DeleteRepositoryBranches, "repositoryId">,
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
    const deleting = branches.filter(
      (branch) => !unmerged.some((entry) => entry.branch === branch),
    );
    const remotes = yield* deleteRemotes(
      git,
      worktreePath,
      deleting.flatMap(({ remote }) => (remote === undefined ? [] : [remote])),
    );
    const deleted = deleting.filter(
      ({ remote }) => remote === undefined || remotes.deleted.includes(remote),
    );
    yield* deleteLocals(
      git,
      worktreePath,
      deleted.flatMap(({ local }) => (local === undefined ? [] : [local])),
    );
    if (remotes.failure === undefined) return { deleted, unmerged };
    if (deleted.length === 0) return yield* Effect.fail(remotes.failure);
    return { deleted, unmerged, failure: remotes.failure };
  });
}

export function readRefTargets(git: GitCommandRunner, directory: string) {
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

export function unmergedBranches(
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
  return Effect.gen(function* () {
    const deleted: RemoteTarget[] = [];
    for (const [remote, batch] of remoteBatches(remotes)) {
      const pushed = yield* Effect.result(
        pushDeletes(git, directory, remote, batch),
      );
      if (Result.isFailure(pushed)) return { deleted, failure: pushed.failure };
      deleted.push(...pushed.success.deleted);
      if (pushed.success.failure !== undefined)
        return { deleted, failure: pushed.success.failure };
    }
    return { deleted };
  });
}

function remoteBatches(remotes: readonly RemoteTarget[]) {
  return [...Map.groupBy(remotes, ({ remote }) => remote)].flatMap(
    ([remote, group]) =>
      Arrays.chunksOf(group, pushedPerCommand).map(
        (batch) => [remote, batch] as const,
      ),
  );
}

function pushDeletes(
  git: GitCommandRunner,
  directory: string,
  remote: string,
  batch: readonly RemoteTarget[],
) {
  return pushUntilSettled(git, directory, remote, batch, {
    gone: [],
    pushed: [],
    stderr: "",
  }).pipe(
    Effect.flatMap((passes) => {
      const outcome = pushedDeletes(batch, passes);
      return forgetRemoteRefs(
        git,
        directory,
        outcome.deleted.filter((target) => passes.gone.includes(target)),
      ).pipe(Effect.as(outcome));
    }),
  );
}

function pushUntilSettled(
  git: GitCommandRunner,
  directory: string,
  remote: string,
  pending: readonly RemoteTarget[],
  passes: PushPasses,
): Effect.Effect<
  PushPasses,
  RepositoryBranchesOperationFailure | RepositoryRejected
> {
  return runRepositoryGitOutput(
    git,
    directory,
    [
      "push",
      "--porcelain",
      ...pending.map(
        ({ name, target }) => `--force-with-lease=refs/heads/${name}:${target}`,
      ),
      remote,
      "--delete",
      ...pending.map(({ name }) => name),
    ],
    { ...pushCommand, exitCodes: [0, 1] },
  ).pipe(
    Effect.mapError((error) =>
      branchWriteFailed(error, `${remote}/${pending[0]?.name ?? ""}`),
    ),
    Effect.flatMap(({ stderr, stdout }) => {
      const gone = pending.filter(({ name }) =>
        stderr.includes(
          `unable to delete '${name}': remote ref does not exist`,
        ),
      );
      const next = {
        gone: [...passes.gone, ...gone],
        pushed: [...passes.pushed, ...pushedRefs(stdout)],
        stderr,
      };
      const rest = pending.filter((target) => !gone.includes(target));
      return gone.length === 0 || rest.length === 0
        ? Effect.succeed(next)
        : pushUntilSettled(git, directory, remote, rest, next);
    }),
  );
}

function pushedRefs(stdout: string): readonly PushedRef[] {
  return stdout.split("\n").flatMap((line) => {
    const [flag = "", refs, summary = ""] = line.split("\t");
    return refs === undefined
      ? []
      : [{ flag, ref: refs.slice(refs.lastIndexOf(":") + 1), summary }];
  });
}

function pushedDeletes(
  batch: readonly RemoteTarget[],
  { gone, pushed, stderr }: PushPasses,
): {
  readonly deleted: readonly RemoteTarget[];
  readonly failure?: RepositoryBranchesOperationFailure | RepositoryRejected;
} {
  const outcomes = (name: string) =>
    pushed.filter(({ ref }) => ref === branchRef(name));
  const rejection = (name: string) =>
    outcomes(name).find(({ flag }) => flag !== "-");
  const isDeleted = (target: RemoteTarget) =>
    (gone.includes(target) || outcomes(target.name).length > 0) &&
    rejection(target.name) === undefined;
  const deleted = batch.filter(isDeleted);
  const rejected = batch.find((target) => !isDeleted(target));
  if (rejected === undefined) return { deleted };
  const name = remoteLabel(rejected);
  const summary = rejection(rejected.name)?.summary;
  return {
    deleted,
    failure: /\((?:stale info|fetch first)\)$/.test(summary ?? "")
      ? { _tag: "BranchMoved", name }
      : repositoryRejected(
          "GitFailed",
          summary === undefined ? stderr.trim() || name : `${name}: ${summary}`,
        ),
  };
}

function forgetRemoteRefs(
  git: GitCommandRunner,
  directory: string,
  remotes: readonly RemoteTarget[],
) {
  if (remotes.length === 0) return Effect.void;
  return runRepositoryGit(git, directory, ["update-ref", "--stdin"], {
    ...refCommand,
    input: remotes.map((remote) => `delete ${remoteRef(remote)}\n`).join(""),
  }).pipe(
    Effect.mapError((error) => repositoryRejected("GitFailed", error.detail)),
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
