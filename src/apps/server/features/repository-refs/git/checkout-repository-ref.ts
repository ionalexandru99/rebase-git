import { randomUUID } from "node:crypto";
import type {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryRefTarget,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import type {
  GitCommandOutput,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import type { RepositoryRefsError } from "#server/domain/repository-refs.contract";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/features/repository-refs/git/read-repository-refs";
import {
  checkoutFailure,
  failureDetail,
  gitCommandFailed,
  repositoryRefsFailure,
} from "#server/features/repository-refs/git/repository-refs-failures";

const checkoutTimeoutMilliseconds = 60_000;

export function checkoutRepositoryRef(
  git: GitCommandRunner,
  repositoryPath: string,
  command: CheckoutRepositoryRef,
): Effect.Effect<RepositoryCheckedOut, RepositoryRefsError> {
  return Effect.gen(function* () {
    const worktrees = yield* readCanonicalWorktrees(git, repositoryPath);
    const worktree = yield* requireWorktree(worktrees, command.worktreePath);
    const target = yield* resolveTarget(git, worktree.path, command.target);
    yield* rejectBranchCheckedOutElsewhere(worktrees, worktree, target);
    if (target._tag === "LocalBranch" && worktree.head.branch === target.name) {
      return {
        head: worktree.head,
        stash: "none",
        worktreePath: worktree.path,
      };
    }

    const stash = yield* Effect.uninterruptible(
      checkoutWithAutoStash(git, worktree.path, target),
    );
    const head = yield* readCheckedOutHead(git, repositoryPath, worktree.path);
    return { head, stash, worktreePath: worktree.path };
  });
}

function checkoutWithAutoStash(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
): Effect.Effect<RepositoryCheckedOut["stash"], RepositoryRefsError> {
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

function readCanonicalWorktrees(git: GitCommandRunner, repositoryPath: string) {
  return readWorktrees(git, repositoryPath).pipe(
    Effect.flatMap(canonicalizeWorktrees),
  );
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
        repositoryRefsFailure({ _tag: "WorktreeMissing", worktreePath }),
      )
    : Effect.succeed(worktree);
}

function resolveTarget(
  git: GitCommandRunner,
  directory: string,
  target: RepositoryRefTarget,
): Effect.Effect<CheckoutTarget, RepositoryRefsError> {
  if (target._tag !== "RemoteBranch") return Effect.succeed(target);
  return Effect.gen(function* () {
    const local = yield* runGit(git, directory, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${target.name}`,
    ]);
    if (local.exitCode !== 0) return target;
    const upstream = yield* runGit(git, directory, [
      "rev-parse",
      "--abbrev-ref",
      "--quiet",
      `${target.name}@{upstream}`,
    ]);
    const tracked = upstream.exitCode === 0 ? upstream.stdout.trim() : "";
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
    : Effect.fail(
        repositoryRefsFailure({
          _tag: "BranchCheckedOutElsewhere",
          name: target.name,
          worktreePath: elsewhere.path,
        }),
      );
}

function stashLocalChanges(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
) {
  return Effect.gen(function* () {
    const status = yield* runGit(git, directory, [
      "status",
      "--porcelain",
      "-z",
    ]);
    if (status.exitCode !== 0) {
      return yield* Effect.fail(checkoutFailure(status.stderr, target.name));
    }
    if (status.stdout.length === 0) return undefined;

    const token = `rebase-auto-stash:${randomUUID()}`;
    const stash = yield* runGit(git, directory, [
      "stash",
      "push",
      "--include-untracked",
      "--message",
      `${token} before checking out ${target.name}`,
    ]);
    const entry = yield* findStash(git, directory, token);
    if (stash.exitCode !== 0 || entry === undefined) {
      return yield* Effect.fail(
        repositoryRefsFailure({
          _tag: "CheckoutRejected",
          detail: failureDetail(stash.stderr),
          reason: "StashFailed",
        }),
      );
    }
    return token;
  });
}

function findStash(git: GitCommandRunner, directory: string, token: string) {
  return runGit(git, directory, ["stash", "list", "--format=%H%x00%s"]).pipe(
    Effect.map((listed) => {
      const lines = listed.stdout.split("\n");
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
  return runGit(git, directory, checkoutArguments(target)).pipe(
    Effect.flatMap((output) =>
      output.exitCode === 0
        ? Effect.void
        : Effect.fail(checkoutFailure(output.stderr, target.name)),
    ),
  );
}

function checkoutArguments(target: CheckoutTarget): readonly string[] {
  switch (target._tag) {
    case "LocalBranch":
      return ["checkout", target.name];
    case "RemoteBranch":
      return [
        "checkout",
        "-b",
        target.name,
        "--track",
        `${target.remote}/${target.name}`,
      ];
    case "DetachedRemoteBranch":
      return [
        "checkout",
        "--detach",
        `refs/remotes/${target.remote}/${target.name}`,
      ];
    case "Tag":
      return ["checkout", "--detach", `refs/tags/${target.name}`];
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
    const applied = yield* runGit(git, directory, [
      "stash",
      "apply",
      entry.commit,
    ]);
    if (applied.exitCode !== 0) return false;
    const current = yield* findStash(git, directory, token);
    if (current !== undefined) {
      yield* runGit(git, directory, [
        "stash",
        "drop",
        `stash@{${current.index}}`,
      ]);
    }
    return true;
  });
}

function readCheckedOutHead(
  git: GitCommandRunner,
  repositoryPath: string,
  worktreePath: string,
) {
  return readCanonicalWorktrees(git, repositoryPath).pipe(
    Effect.flatMap((worktrees) => requireWorktree(worktrees, worktreePath)),
    Effect.map((worktree) => worktree.head),
  );
}

function runGit(
  git: GitCommandRunner,
  directory: string,
  arguments_: readonly string[],
): Effect.Effect<GitCommandOutput, RepositoryRefsError> {
  return git
    .run({
      arguments: arguments_,
      directory,
      timeoutMilliseconds: checkoutTimeoutMilliseconds,
    })
    .pipe(Effect.mapError(gitCommandFailed));
}
