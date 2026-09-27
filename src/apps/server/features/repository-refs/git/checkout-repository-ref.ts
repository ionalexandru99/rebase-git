import { randomUUID } from "node:crypto";
import { Effect } from "effect";
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
import {
  type GitCommandRunner,
  type GitFailed,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const checkoutCommand = {
  literalPathspecs: false,
  timeoutMilliseconds: 60_000,
};

export function checkoutRepositoryRef(
  git: GitCommandRunner,
  access: RepositoryAccess,
  command: CheckoutRepositoryRef,
): Effect.Effect<
  RepositoryCheckedOut,
  RepositoryCheckoutFailure | RepositoryRejected | GitFailed
> {
  return Effect.gen(function* () {
    const worktrees = yield* access.worktrees(command.worktreePath);
    const worktree = yield* requireWorktree(worktrees, command.worktreePath);
    const target = yield* resolveTarget(git, worktree.path, command.target);
    yield* rejectBranchCheckedOutElsewhere(worktrees, worktree, target);
    if (target._tag === "LocalBranch" && worktree.head.branch === target.name) {
      return {
        head: worktree.head,
        stash: "none" as const,
        worktreePath: worktree.path,
      };
    }

    const stash = yield* Effect.uninterruptible(
      checkoutWithAutoStash(git, worktree.path, target),
    );
    const head = yield* readCheckedOutHead(access, worktree.path);
    return { head, stash, worktreePath: worktree.path };
  });
}

function checkoutWithAutoStash(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
): Effect.Effect<
  RepositoryCheckedOut["stash"],
  RepositoryCheckoutFailure | RepositoryRejected | GitFailed
> {
  return Effect.gen(function* () {
    const stash = yield* stashLocalChanges(git, directory, target);
    if (stash === undefined) {
      yield* runCheckout(git, directory, target);
      return "none";
    }
    yield* runCheckout(git, directory, target).pipe(
      Effect.tapError(() =>
        restoreStash(git, directory, stash).pipe(Effect.ignore),
      ),
    );
    return (yield* restoreStash(git, directory, stash)) ? "restored" : "kept";
  });
}

function requireWorktree(
  worktrees: readonly RepositoryWorktree[],
  worktreePath: string,
) {
  const worktree = worktrees.find(
    (candidate) => candidate.path === worktreePath,
  );
  return worktree === undefined
    ? Effect.fail(
        repositoryRejected(
          "Missing",
          "This worktree does not belong to the repository.",
        ),
      )
    : Effect.succeed(worktree);
}

function resolveTarget(
  git: GitCommandRunner,
  directory: string,
  target: RepositoryRefTarget,
): Effect.Effect<CheckoutTarget, GitFailed> {
  if (target._tag !== "RemoteBranch") return Effect.succeed(target);
  return Effect.gen(function* () {
    const local = yield* gitAccepts(git, directory, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${target.name}`,
    ]);
    if (!local) return target;
    const tracked = yield* runRepositoryGit(
      git,
      directory,
      ["rev-parse", "--abbrev-ref", "--quiet", `${target.name}@{upstream}`],
      checkoutCommand,
    ).pipe(
      Effect.map((upstream) => upstream.trim()),
      Effect.catchIf(isGitRejection, () => Effect.succeed("")),
    );
    return tracked.length === 0 || tracked === `${target.remote}/${target.name}`
      ? { _tag: "LocalBranch", name: target.name }
      : {
          _tag: "DetachedRemoteBranch",
          name: target.name,
          remote: target.remote,
        };
  });
}

function rejectBranchCheckedOutElsewhere(
  worktrees: readonly RepositoryWorktree[],
  worktree: RepositoryWorktree,
  target: CheckoutTarget,
) {
  if (target._tag !== "LocalBranch") return Effect.void;
  const elsewhere = worktrees.find(
    (candidate) =>
      candidate.path !== worktree.path && candidate.head.branch === target.name,
  );
  return elsewhere === undefined
    ? Effect.void
    : Effect.fail<RepositoryCheckoutFailure>({
        _tag: "BranchCheckedOutElsewhere",
        name: target.name,
        worktreePath: elsewhere.path,
      });
}

function stashLocalChanges(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
) {
  return Effect.gen(function* () {
    const status = yield* runRepositoryGit(
      git,
      directory,
      ["status", "--porcelain", "-z"],
      checkoutCommand,
    ).pipe(Effect.mapError((error) => checkoutFailure(error, target.name)));
    if (status.length === 0) return undefined;

    const token = `rebase-auto-stash:${randomUUID()}`;
    const stashed = yield* runRepositoryGit(
      git,
      directory,
      [
        "stash",
        "push",
        "--include-untracked",
        "--message",
        `${token} before checking out ${target.name}`,
      ],
      checkoutCommand,
    ).pipe(
      Effect.as(true),
      Effect.catchIf(isGitRejection, () => Effect.succeed(false)),
    );
    const entry = yield* findStash(git, directory, token);
    if (!stashed || entry === undefined) {
      return yield* Effect.fail<RepositoryCheckoutFailure>({
        _tag: "CheckoutRejected",
        reason: "StashFailed",
      });
    }
    return token;
  });
}

function findStash(git: GitCommandRunner, directory: string, token: string) {
  return runRepositoryGit(
    git,
    directory,
    ["stash", "list", "--format=%H%x00%s"],
    checkoutCommand,
  ).pipe(
    Effect.map((listed) => {
      const lines = listed.split("\n");
      const index = lines.findIndex((line) =>
        line.split("\0")[1]?.includes(token),
      );
      const commit = lines[index]?.split("\0")[0];
      return index < 0 || commit === undefined ? undefined : { commit, index };
    }),
  );
}

function runCheckout(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
) {
  return runRepositoryGit(
    git,
    directory,
    checkoutArguments(target),
    checkoutCommand,
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) => checkoutFailure(error, target.name)),
  );
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

type CheckoutTarget =
  | RepositoryRefTarget
  | {
      readonly _tag: "DetachedRemoteBranch";
      readonly name: string;
      readonly remote: string;
    };

function restoreStash(git: GitCommandRunner, directory: string, token: string) {
  return Effect.gen(function* () {
    const entry = yield* findStash(git, directory, token);
    if (entry === undefined) return false;
    const applied = yield* gitAccepts(git, directory, [
      "stash",
      "apply",
      entry.commit,
    ]);
    if (!applied) return false;
    const current = yield* findStash(git, directory, token);
    if (current === undefined) return true;
    return yield* gitAccepts(git, directory, [
      "stash",
      "drop",
      `stash@{${current.index}}`,
    ]);
  });
}

function readCheckedOutHead(access: RepositoryAccess, worktreePath: string) {
  return access.worktrees(worktreePath).pipe(
    Effect.flatMap((worktrees) => requireWorktree(worktrees, worktreePath)),
    Effect.map((worktree) => worktree.head),
  );
}

function gitAccepts(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
) {
  return runRepositoryGit(git, directory, args, checkoutCommand).pipe(
    Effect.as(true),
    Effect.catchIf(isGitRejection, () => Effect.succeed(false)),
  );
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
