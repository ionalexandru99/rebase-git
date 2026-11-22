import { randomUUID } from "node:crypto";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryCheckoutFailure,
  RepositoryRefTarget,
  RepositoryWorktree,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { uninterruptible } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  fetchLargeFiles,
  type GitLfs,
} from "#server/features/repository-lfs/git-lfs.ts";
import { isGitRejected } from "#server/features/repository-refs/git/ref-git.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const checkoutCommand = {
  literalPathspecs: false,
  timeoutMilliseconds: 60_000,
};

export async function checkoutRepositoryRef(
  git: GitCommandRunner,
  access: RepositoryAccess,
  lfs: GitLfs,
  command: CheckoutRepositoryRef,
): Promise<RepositoryCheckedOut> {
  const worktrees = await access.worktrees(command.worktreePath);
  const worktree = requireWorktree(worktrees, command.worktreePath);
  const target = await resolveTarget(git, worktree.path, command.target);
  rejectBranchCheckedOutElsewhere(worktrees, worktree, target);
  if (target._tag === "LocalBranch" && worktree.head.branch === target.name)
    return { head: worktree.head, stash: "none", worktreePath: worktree.path };
  await fetchLargeFiles(
    lfs,
    git,
    worktree.path,
    targetRef(target),
    "remote" in target ? target.remote : undefined,
  );
  const stash = await uninterruptible(() =>
    checkoutWithAutoStash(git, worktree.path, target),
  );
  const head = await readCheckedOutHead(access, worktree.path);
  return { head, stash, worktreePath: worktree.path };
}

async function checkoutWithAutoStash(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
): Promise<RepositoryCheckedOut["stash"]> {
  const stash = await stashLocalChanges(git, directory, target);
  if (stash === undefined) {
    await runCheckout(git, directory, target);
    return "none";
  }
  try {
    await runCheckout(git, directory, target);
  } catch (error) {
    await restoreStash(git, directory, stash).catch(() => undefined);
    throw error;
  }
  return (await restoreStash(git, directory, stash)) ? "restored" : "kept";
}

function requireWorktree(
  worktrees: readonly RepositoryWorktree[],
  worktreePath: string,
) {
  const worktree = worktrees.find(
    (candidate) => candidate.path === worktreePath,
  );
  if (worktree === undefined)
    throw repositoryRejected(
      "Missing",
      "This worktree does not belong to the repository.",
    );
  return worktree;
}

async function resolveTarget(
  git: GitCommandRunner,
  directory: string,
  target: RepositoryRefTarget,
): Promise<CheckoutTarget> {
  if (target._tag !== "RemoteBranch") return target;
  const local = await gitAccepts(git, directory, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${target.name}`,
  ]);
  if (!local) return target;
  const tracked = await readUpstream(git, directory, target.name);
  return tracked.length === 0 || tracked === `${target.remote}/${target.name}`
    ? { _tag: "LocalBranch", name: target.name }
    : {
        _tag: "DetachedRemoteBranch",
        name: target.name,
        remote: target.remote,
      };
}

async function readUpstream(
  git: GitCommandRunner,
  directory: string,
  branch: string,
) {
  try {
    return (
      await runRepositoryGit(
        git,
        directory,
        ["rev-parse", "--abbrev-ref", "--quiet", `${branch}@{upstream}`],
        checkoutCommand,
      )
    ).trim();
  } catch (error) {
    if (isGitRejected(error)) return "";
    throw error;
  }
}

function rejectBranchCheckedOutElsewhere(
  worktrees: readonly RepositoryWorktree[],
  worktree: RepositoryWorktree,
  target: CheckoutTarget,
) {
  if (target._tag !== "LocalBranch") return;
  const elsewhere = worktrees.find(
    (candidate) =>
      candidate.path !== worktree.path && candidate.head.branch === target.name,
  );
  if (elsewhere !== undefined)
    throw {
      _tag: "BranchCheckedOutElsewhere",
      name: target.name,
      worktreePath: elsewhere.path,
    } satisfies RepositoryCheckoutFailure;
}

async function stashLocalChanges(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
) {
  const status = await runCheckoutGit(
    git,
    directory,
    ["status", "--porcelain", "-z"],
    target,
  );
  if (status.length === 0) return undefined;
  const token = `rebase-auto-stash:${randomUUID()}`;
  const stashed = await gitAccepts(git, directory, [
    "stash",
    "push",
    "--include-untracked",
    "--message",
    `${token} before checking out ${target.name}`,
  ]);
  const entry = await findStash(git, directory, token);
  if (!stashed || entry === undefined)
    throw {
      _tag: "CheckoutRejected",
      reason: "StashFailed",
    } satisfies RepositoryCheckoutFailure;
  return token;
}

async function findStash(
  git: GitCommandRunner,
  directory: string,
  token: string,
) {
  const listed = await runRepositoryGit(
    git,
    directory,
    ["stash", "list", "--format=%H%x00%s"],
    checkoutCommand,
  );
  const lines = listed.split("\n");
  const index = lines.findIndex((line) => line.split("\0")[1]?.includes(token));
  const commit = lines[index]?.split("\0")[0];
  return index < 0 || commit === undefined ? undefined : { commit, index };
}

async function runCheckout(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
) {
  await runCheckoutGit(git, directory, checkoutArguments(target), target);
}

async function runCheckoutGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  target: CheckoutTarget,
) {
  try {
    return await runRepositoryGit(git, directory, args, checkoutCommand);
  } catch (error) {
    throw isGitFailed(error) ? checkoutFailure(error, target.name) : error;
  }
}

function checkoutArguments(target: CheckoutTarget): readonly string[] {
  switch (target._tag) {
    case "LocalBranch":
      return ["switch", target.name];
    case "RemoteBranch":
      return [
        "switch",
        "--create",
        target.name,
        "--track",
        `refs/remotes/${target.remote}/${target.name}`,
      ];
    case "DetachedRemoteBranch":
      return [
        "switch",
        "--detach",
        `refs/remotes/${target.remote}/${target.name}`,
      ];
    case "Tag":
      return ["switch", "--detach", `refs/tags/${target.name}`];
  }
}

function targetRef(target: CheckoutTarget) {
  switch (target._tag) {
    case "LocalBranch":
      return `refs/heads/${target.name}`;
    case "Tag":
      return `refs/tags/${target.name}`;
    default:
      return `refs/remotes/${target.remote}/${target.name}`;
  }
}

type CheckoutTarget =
  | RepositoryRefTarget
  | {
      readonly _tag: "DetachedRemoteBranch";
      readonly name: string;
      readonly remote: string;
    };

async function restoreStash(
  git: GitCommandRunner,
  directory: string,
  token: string,
) {
  const entry = await findStash(git, directory, token);
  if (entry === undefined) return false;
  if (!(await gitAccepts(git, directory, ["stash", "apply", entry.commit])))
    return false;
  const current = await findStash(git, directory, token);
  if (current === undefined) return true;
  return gitAccepts(git, directory, [
    "stash",
    "drop",
    `stash@{${current.index}}`,
  ]);
}

async function readCheckedOutHead(
  access: RepositoryAccess,
  worktreePath: string,
) {
  const worktrees = await access.worktrees(worktreePath);
  return requireWorktree(worktrees, worktreePath).head;
}

async function gitAccepts(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
) {
  try {
    await runRepositoryGit(git, directory, args, checkoutCommand);
    return true;
  } catch (error) {
    if (isGitRejected(error)) return false;
    throw error;
  }
}

export function checkoutFailure(
  error: GitFailed,
  targetName: string,
): RepositoryCheckoutFailure | RepositoryRejected {
  if (!isGitRejection(error))
    return repositoryRejected("GitFailed", error.detail);
  const elsewhere =
    /already (?:checked out|used by worktree) at '([^']+)'/.exec(error.detail);
  if (elsewhere?.[1] !== undefined) {
    return {
      _tag: "BranchCheckedOutElsewhere",
      name: targetName,
      worktreePath: elsewhere[1],
    };
  }
  if (
    /did not match any file\(s\) known to git|invalid reference|is not a commit and a branch/i.test(
      error.detail,
    )
  ) {
    return { _tag: "RefMissing", name: targetName };
  }
  if (/would be overwritten by checkout/i.test(error.detail)) {
    return {
      _tag: "CheckoutRejected",
      reason: "LocalChanges",
    };
  }
  return repositoryRejected("GitFailed", error.detail);
}
