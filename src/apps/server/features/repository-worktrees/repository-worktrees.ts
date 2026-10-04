import { readdir, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import {
  type CreateWorktree,
  type RemoveWorktree,
  type RepositoryWorktreeStatus,
  RepositoryWorktreesApi,
  type WorktreeChanged,
  type WorktreeRejected,
  type WorktreeTarget,
} from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { conflicted } from "#server/features/repository-changes/git/read-changes.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  readBranchTarget,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import {
  readWorktreeFolder,
  setWorktreeFolder,
} from "#server/features/repository-worktrees/worktree-folder.ts";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access.ts";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination.ts";

const worktreeCommand = { ...refCommand, timeoutMilliseconds: 300_000 };

const worktreePolicy: RepositoryWritePolicy = {
  name: "change worktrees",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

export function repositoryWorktreesFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryWorktreesApi;
  return {
    routes: [
      query(api.status, (input, git) =>
        readWorktreeStatus(git, input.worktreePath),
      ),
      query(api.folder, (input, git) =>
        readWorktreeFolder(git, input.worktreePath),
      ),
      command(api.create, worktreePolicy, (input, git) =>
        createWorktree(git, input),
      ),
      command(api.remove, worktreePolicy, (input, git) =>
        removeWorktree(git, input),
      ),
      command(api.unlock, worktreePolicy, (input, git) =>
        unlockWorktree(git, input),
      ),
      command(api.setFolder, worktreePolicy, (input, git) =>
        setWorktreeFolder(git, input),
      ),
    ],
  };
}

export function readWorktreeStatus(git: GitCommandRunner, directory: string) {
  return listWorktrees(git, directory).pipe(
    Effect.flatMap((worktrees) =>
      Effect.all(
        worktrees
          .filter((worktree) => worktree.missing !== true)
          .map((worktree) =>
            countChanges(git, worktree.path).pipe(
              Effect.map((counts) => ({ path: worktree.path, ...counts })),
            ),
          ),
        { concurrency: 4 },
      ),
    ),
    Effect.map((worktrees): RepositoryWorktreeStatus => ({ worktrees })),
  );
}

export function createWorktree(git: GitCommandRunner, command: CreateWorktree) {
  const { start, worktreePath: directory } = command;
  return Effect.gen(function* () {
    if (!isAbsolute(command.path))
      return yield* Effect.fail(rejected("NotAbsolute"));
    if (!(yield* folderIsFree(command.path)))
      return yield* Effect.fail(rejected("FolderExists"));
    if (start._tag === "Branch") {
      if ((yield* readBranchTarget(git, directory, start.name)) === undefined)
        return yield* Effect.fail({
          _tag: "RefMissing" as const,
          name: start.name,
        });
      yield* addWorktree(git, directory, start.name, [
        command.path,
        start.name,
      ]);
    } else {
      const { name, startPoint, track } = start;
      yield* requireValidBranchName(git, directory, name);
      if (track !== undefined)
        yield* requireRemoteBranch(git, directory, track);
      yield* runRepositoryGit(
        git,
        directory,
        ["branch", "--no-track", name, startPoint],
        refCommand,
      ).pipe(
        Effect.mapError((error) =>
          /not a valid object name/i.test(error.detail)
            ? { _tag: "RefMissing" as const, name: startPoint }
            : branchWriteFailed(error, name),
        ),
      );
      yield* Effect.gen(function* () {
        if (track !== undefined)
          yield* runRepositoryGit(
            git,
            directory,
            setUpstreamArguments(name, track),
            refCommand,
          ).pipe(Effect.mapError((error) => branchWriteFailed(error, name)));
        yield* addWorktree(git, directory, name, [command.path, name]);
      }).pipe(
        Effect.onError(() =>
          runRepositoryGit(
            git,
            directory,
            ["branch", "-D", name],
            refCommand,
          ).pipe(Effect.ignore),
        ),
      );
    }
    const worktreePath = yield* Effect.promise(() =>
      realpath(command.path).catch(() => command.path),
    );
    return { worktreePath };
  });
}

export function removeWorktree(
  git: GitCommandRunner,
  command: Omit<RemoveWorktree, "repositoryId">,
) {
  return Effect.gen(function* () {
    const worktree = yield* findRemovable(git, command);
    if (worktree === undefined) return {};
    if (
      worktree.head.branch === undefined &&
      (yield* commitsOnNoBranch(
        git,
        command.worktreePath,
        worktree.head.commit,
      ))
    )
      return yield* Effect.fail(rejected("Unsaved"));
    const { unstaged, staged } =
      worktree.missing === true
        ? { unstaged: 0, staged: 0 }
        : yield* countChanges(git, worktree.path);
    const changes = unstaged + staged;
    if (changes > 0 && changes !== command.changes)
      return yield* Effect.fail<WorktreeChanged>({
        _tag: "WorktreeChanged",
        changes,
      });
    yield* runRepositoryGit(
      git,
      command.worktreePath,
      [
        "worktree",
        "remove",
        ...(changes > 0 ? ["--force"] : []),
        worktree.path,
      ],
      worktreeCommand,
    );
    return {};
  });
}

export function unlockWorktree(git: GitCommandRunner, command: WorktreeTarget) {
  return Effect.gen(function* () {
    const worktree = yield* findTarget(git, command);
    if (worktree?.locked === undefined) return {};
    yield* runRepositoryGit(
      git,
      command.worktreePath,
      ["worktree", "unlock", worktree.path],
      refCommand,
    );
    return {};
  });
}

function addWorktree(
  git: GitCommandRunner,
  directory: string,
  branch: string,
  arguments_: readonly string[],
) {
  return runRepositoryGit(
    git,
    directory,
    ["worktree", "add", ...arguments_],
    worktreeCommand,
  ).pipe(Effect.mapError((error) => addFailed(error, branch)));
}

function addFailed(error: GitFailed, branch: string) {
  if (/^fatal: '.*' already exists$/m.test(error.detail))
    return rejected("FolderExists");
  const holder = /already (?:checked out|used by worktree) at '([^']+)'/.exec(
    error.detail,
  )?.[1];
  if (holder !== undefined)
    return {
      _tag: "BranchCheckedOutElsewhere" as const,
      name: branch,
      worktreePath: holder,
    };
  return branchWriteFailed(error, branch);
}

function folderIsFree(path: string) {
  return Effect.promise(() =>
    readdir(path).then(
      (entries) => entries.length === 0,
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    ),
  );
}

function findRemovable(
  git: GitCommandRunner,
  command: Omit<WorktreeTarget, "repositoryId">,
) {
  return Effect.gen(function* () {
    const worktree = yield* findTarget(git, command);
    if (worktree === undefined) return undefined;
    if (worktree.main) return yield* Effect.fail(rejected("Main"));
    if (worktree.path === command.worktreePath)
      return yield* Effect.fail(rejected("Current"));
    if (worktree.locked !== undefined)
      return yield* Effect.fail(rejected("Locked"));
    return worktree;
  });
}

function findTarget(
  git: GitCommandRunner,
  command: Omit<WorktreeTarget, "repositoryId">,
) {
  return listWorktrees(git, command.worktreePath).pipe(
    Effect.map((worktrees) =>
      worktrees.find((worktree) => worktree.path === command.target),
    ),
  );
}

function listWorktrees(git: GitCommandRunner, directory: string) {
  return readWorktrees(git, directory).pipe(
    Effect.flatMap(canonicalizeWorktrees),
  );
}

function commitsOnNoBranch(
  git: GitCommandRunner,
  directory: string,
  commit: string,
) {
  return runRepositoryGit(
    git,
    directory,
    [
      "rev-list",
      "--max-count=1",
      commit,
      "--not",
      "--branches",
      "--tags",
      "--remotes",
    ],
    refCommand,
  ).pipe(Effect.map((output) => output.trim().length > 0));
}

function countChanges(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "status",
    "--porcelain",
    "-z",
    "--no-renames",
    "--untracked-files=normal",
  ]).pipe(
    Effect.map((output) => {
      const codes = output
        .split("\0")
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.slice(0, 2));
      return {
        unstaged: codes.filter((xy) => xy[1] !== " ").length,
        staged: codes.filter(
          (xy) => xy[0] !== " " && xy[0] !== "?" && !conflicted(xy),
        ).length,
      };
    }),
  );
}

function rejected(reason: WorktreeRejected["reason"]): WorktreeRejected {
  return { _tag: "WorktreeRejected", reason };
}
