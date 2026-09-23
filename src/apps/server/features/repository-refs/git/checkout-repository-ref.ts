import { randomUUID } from "node:crypto";
import type {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryRefTarget,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import type { RepositoryRefsError } from "#server/features/repository-refs/git/repository-refs-failures";
import {
  checkoutFailure,
  gitFailed,
  repositoryAccessFailed,
  repositoryRefsFailure,
} from "#server/features/repository-refs/git/repository-refs-failures";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

const checkoutCommand = {
  literalPathspecs: false,
  timeoutMilliseconds: 60_000,
};

export function checkoutRepositoryRef(
  git: GitCommandRunner,
  access: RepositoryAccessService,
  command: CheckoutRepositoryRef,
): Effect.Effect<
  RepositoryCheckedOut,
  EnvironmentStorageError | RepositoryRefsError
> {
  return Effect.gen(function* () {
    const worktrees = yield* readCanonicalWorktrees(
      access,
      command.worktreePath,
    );
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
  }).pipe(
    Effect.catchTag("RepositoryGitError", (error) =>
      Effect.fail(gitFailed(error)),
    ),
  );
}

function checkoutWithAutoStash(
  git: GitCommandRunner,
  directory: string,
  target: CheckoutTarget,
): Effect.Effect<
  RepositoryCheckedOut["stash"],
  RepositoryRefsError | RepositoryGitError
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

function readCanonicalWorktrees(
  access: RepositoryAccessService,
  directory: string,
) {
  return access
    .worktrees(directory)
    .pipe(Effect.mapError(repositoryAccessFailed));
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
): Effect.Effect<CheckoutTarget, RepositoryGitError> {
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
    const status = yield* runRepositoryGit(
      git,
      directory,
      ["status", "--porcelain", "-z"],
      checkoutCommand,
    ).pipe(Effect.mapError((error) => checkoutFailure(error, target.name)));
    if (status.length === 0) return undefined;

    const token = `rebase-auto-stash:${randomUUID()}`;
    const stashFailure = yield* runRepositoryGit(
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
      Effect.as(""),
      Effect.catchIf(isGitRejection, (error) => Effect.succeed(error.detail)),
    );
    const entry = yield* findStash(git, directory, token);
    if (stashFailure !== "" || entry === undefined) {
      return yield* Effect.fail(
        repositoryRefsFailure({
          _tag: "CheckoutRejected",
          detail: stashFailure,
          reason: "StashFailed",
        }),
      );
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

function readCheckedOutHead(
  access: RepositoryAccessService,
  worktreePath: string,
) {
  return readCanonicalWorktrees(access, worktreePath).pipe(
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
