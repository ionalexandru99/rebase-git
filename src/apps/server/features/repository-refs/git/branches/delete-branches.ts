import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type {
  BranchCommitSummary,
  BranchDeletion,
  DeleteRepositoryBranches,
  ReadUnmergedBranches,
  RepositoryBranchesDeleted,
  RepositoryBranchesOperationFailure,
  UnmergedBranch,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  branchRef,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import {
  isGitRejected,
  refCommand,
} from "#server/features/repository-refs/git/ref-git.ts";
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

interface PushResult {
  readonly pushed: readonly PushedRef[];
  readonly stderr: string;
}

type DeletionFailure = RepositoryBranchesOperationFailure | RepositoryRejected;

interface PushedDeletes {
  readonly deleted: readonly RemoteTarget[];
  readonly failure?: DeletionFailure;
}

export async function deleteBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  { branches, force, worktreePath }: DeleteRepositoryBranches,
): Promise<RepositoryBranchesDeleted> {
  const refs = await readRefTargets(git, worktreePath);
  const worktrees = await access.worktrees(worktreePath);
  const problem = branches
    .map((branch) => deletionProblem(branch, refs, worktrees))
    .find(isDefined);
  if (problem !== undefined) throw problem;
  const unmerged = force
    ? []
    : await unmergedBranches(git, worktreePath, branches, refs);
  const deleting = branches.filter(
    (branch) => !unmerged.some((entry) => entry.branch === branch),
  );
  const remotes = await deleteRemotes(
    git,
    worktreePath,
    deleting.flatMap(({ remote }) => (remote === undefined ? [] : [remote])),
  );
  const deleted = deleting.filter(
    ({ remote }) => remote === undefined || remotes.deleted.includes(remote),
  );
  await deleteLocals(
    git,
    worktreePath,
    deleted.flatMap(({ local }) => (local === undefined ? [] : [local])),
  );
  if (remotes.failure === undefined) return { deleted, unmerged };
  if (deleted.length === 0) throw remotes.failure;
  return { deleted, unmerged, failure: remotes.failure };
}

export async function readUnmergedBranches(
  git: GitCommandRunner,
  { branches, worktreePath }: ReadUnmergedBranches,
) {
  const refs = await readRefTargets(git, worktreePath);
  return unmergedBranches(git, worktreePath, branches, refs);
}

export async function readRefTargets(
  git: GitCommandRunner,
  directory: string,
): Promise<RefTargets> {
  const output = await runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(symref)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ],
    refCommand,
  );
  return new Map(
    output
      .split("\n")
      .map((line) => line.split("\0"))
      .filter(([ref = "", , symref = ""]) => ref !== "" && symref === "")
      .map(([ref = "", target = ""]) => [ref, target]),
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

export async function unmergedBranches(
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
  const lost = await countCommits(
    git,
    directory,
    onlyOn(branches.flatMap(targets)),
  );
  if (lost === 0) return [];
  const entries: (UnmergedBranch | undefined)[] = [];
  for (let start = 0; start < branches.length; start += unmergedChecks)
    entries.push(
      ...(await Promise.all(
        branches
          .slice(start, start + unmergedChecks)
          .map((branch) =>
            unmergedBranch(git, directory, branch, onlyOn(targets(branch))),
          ),
      )),
    );
  return entries.filter(isDefined);
}

async function unmergedBranch(
  git: GitCommandRunner,
  directory: string,
  branch: BranchDeletion,
  revisions: string,
): Promise<UnmergedBranch | undefined> {
  const [count, log] = await Promise.all([
    countCommits(git, directory, revisions),
    runRepositoryGit(
      git,
      directory,
      ["log", "--format=%H%x00%s", `--max-count=${listedCommits}`, "--stdin"],
      { ...refCommand, input: revisions },
    ),
  ]);
  return count === 0
    ? undefined
    : { branch, commits: parseCommits(log), count };
}

async function countCommits(
  git: GitCommandRunner,
  directory: string,
  revisions: string,
) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["rev-list", "--count", "--stdin"],
    { ...refCommand, input: revisions },
  );
  return Number.parseInt(output.trim(), 10);
}

async function deleteRemotes(
  git: GitCommandRunner,
  directory: string,
  remotes: readonly RemoteTarget[],
): Promise<PushedDeletes> {
  const deleted: RemoteTarget[] = [];
  for (const [remote, batch] of remoteBatches(remotes)) {
    const pushed = await pushDeletes(git, directory, remote, batch);
    deleted.push(...pushed.deleted);
    if (pushed.failure !== undefined)
      return { deleted, failure: pushed.failure };
  }
  return { deleted };
}

function remoteBatches(remotes: readonly RemoteTarget[]) {
  const batches: (readonly [string, readonly RemoteTarget[]])[] = [];
  for (const [remote, group] of Map.groupBy(remotes, ({ remote }) => remote))
    for (let start = 0; start < group.length; start += pushedPerCommand)
      batches.push([remote, group.slice(start, start + pushedPerCommand)]);
  return batches;
}

async function pushDeletes(
  git: GitCommandRunner,
  directory: string,
  remote: string,
  batch: readonly RemoteTarget[],
): Promise<PushedDeletes> {
  const leased = await pushDelete(git, directory, remote, batch, leaseTarget);
  if ("failure" in leased) return { deleted: [], failure: leased.failure };
  const stale = batch.filter(({ name }) =>
    isStale(rejection(leased.pushed, name)?.summary),
  );
  if (stale.length === 0) return pushedDeletes(batch, leased);
  const absent = await pushDelete(git, directory, remote, stale, leaseAbsent);
  if ("failure" in absent) return { deleted: [], failure: absent.failure };
  return pushedDeletes(batch, {
    pushed: [
      ...leased.pushed.filter(
        ({ ref }) => !stale.some(({ name }) => ref === branchRef(name)),
      ),
      ...absent.pushed,
    ],
    stderr: absent.stderr,
  });
}

async function pushDelete(
  git: GitCommandRunner,
  directory: string,
  remote: string,
  pending: readonly RemoteTarget[],
  lease: (target: RemoteTarget) => string,
): Promise<PushResult | { readonly failure: DeletionFailure }> {
  try {
    const { stderr, stdout } = await runRepositoryGitOutput(
      git,
      directory,
      [
        "push",
        "--porcelain",
        ...pending.map(
          (target) =>
            `--force-with-lease=${branchRef(target.name)}:${lease(target)}`,
        ),
        remote,
        "--delete",
        ...pending.map(({ name }) => branchRef(name)),
      ],
      { ...pushCommand, exitCodes: [0, 1] },
    );
    return { pushed: pushedRefs(stdout), stderr };
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    return {
      failure: branchWriteFailed(error, `${remote}/${pending[0]?.name ?? ""}`),
    };
  }
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
  { pushed, stderr }: PushResult,
): PushedDeletes {
  const isDeleted = ({ name }: RemoteTarget) =>
    pushed.some(({ ref }) => ref === branchRef(name)) &&
    rejection(pushed, name) === undefined;
  const deleted = batch.filter(isDeleted);
  const rejected = batch.find((target) => !isDeleted(target));
  if (rejected === undefined) return { deleted };
  const name = remoteLabel(rejected);
  const summary = rejection(pushed, rejected.name)?.summary;
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

function rejection(pushed: readonly PushedRef[], name: string) {
  return pushed.find(
    ({ flag, ref }) => ref === branchRef(name) && flag !== "-",
  );
}

function leaseTarget({ target }: RemoteTarget) {
  return target;
}

function leaseAbsent() {
  return "";
}

function isStale(summary: string | undefined) {
  return summary?.endsWith("(stale info)") === true;
}

export async function deleteLocals(
  git: GitCommandRunner,
  directory: string,
  locals: readonly LocalTarget[],
) {
  if (locals.length === 0) return;
  try {
    await runRepositoryGit(git, directory, ["update-ref", "--stdin"], {
      ...refCommand,
      input: locals
        .map(({ name, target }) => `delete ${branchRef(name)} ${target}\n`)
        .join(""),
    });
  } catch (error) {
    if (!isGitRejected(error)) throw error;
    throw {
      _tag: "BranchMoved",
      name:
        /'refs\/heads\/([^']+)'/.exec(error.detail)?.[1] ??
        locals[0]?.name ??
        "",
    } satisfies RepositoryBranchesOperationFailure;
  }
  for (const { name } of locals)
    await runRepositoryGit(
      git,
      directory,
      ["config", "--remove-section", `branch.${name}`],
      { ...refCommand, exitCodes: [0, 1, 128] },
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
