import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { Effect } from "effect";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type CreateWorktree,
  type RemoveWorktree,
  type RepositoryWorktreeStatus,
  RepositoryWorktreesApi,
  type SetWorktreeFolder,
  type WorktreeChanged,
  type WorktreeFolder,
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
  readGitCommonDirectory,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  readBranchTarget,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access.ts";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination.ts";

const folderKey = "rebase.worktreeFolder";
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
              Effect.map((changes) => ({ path: worktree.path, changes })),
            ),
          ),
        { concurrency: 4 },
      ),
    ),
    Effect.map((worktrees): RepositoryWorktreeStatus => ({ worktrees })),
  );
}

export function readWorktreeFolder(git: GitCommandRunner, directory: string) {
  return Effect.gen(function* () {
    const configured = yield* readConfiguredFolder(git, directory);
    return {
      folder:
        configured ??
        (yield* defaultWorktreeFolder(
          git,
          directory,
          yield* listWorktrees(git, directory),
        )),
      configured: configured !== undefined,
      separator: sep === "\\" ? "\\" : "/",
    } satisfies WorktreeFolder;
  });
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
      yield* requireValidBranchName(git, directory, start.name);
      if (start.track !== undefined)
        yield* requireRemoteBranch(git, directory, start.track);
      yield* addWorktree(git, directory, start.name, [
        "-b",
        start.name,
        command.path,
        start.startPoint,
      ]);
      if (start.track !== undefined)
        yield* runRepositoryGit(
          git,
          directory,
          setUpstreamArguments(start.name, start.track),
          refCommand,
        ).pipe(
          Effect.mapError((error) => branchWriteFailed(error, start.name)),
        );
    }
    const worktreePath = yield* Effect.promise(() =>
      realpath(command.path).catch(() => command.path),
    );
    return { worktreePath };
  });
}

export function removeWorktree(git: GitCommandRunner, command: RemoveWorktree) {
  return Effect.gen(function* () {
    const worktree = yield* findRemovable(git, command);
    if (worktree === undefined) return {};
    const changes =
      worktree.missing === true ? 0 : yield* countChanges(git, worktree.path);
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

export function setWorktreeFolder(
  git: GitCommandRunner,
  command: SetWorktreeFolder,
) {
  const { folder, worktreePath: directory } = command;
  return Effect.gen(function* () {
    if (folder !== null && !isAbsolute(folder))
      return yield* Effect.fail(rejected("NotAbsolute"));
    yield* runRepositoryGit(
      git,
      directory,
      folder === null
        ? ["config", "--local", "--unset-all", folderKey]
        : ["config", "--local", folderKey, folder],
      { exitCodes: [0, 5] },
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

function findRemovable(git: GitCommandRunner, command: WorktreeTarget) {
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

function findTarget(git: GitCommandRunner, command: WorktreeTarget) {
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

function countChanges(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "status",
    "--porcelain",
    "-z",
    "--no-renames",
    "--untracked-files=normal",
  ]).pipe(
    Effect.map(
      (output) => output.split("\0").filter((entry) => entry.length > 0).length,
    ),
  );
}

function readConfiguredFolder(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["config", "--local", "--get", folderKey],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.map((output) => {
      const folder = output.trim();
      return isAbsolute(folder) ? folder : undefined;
    }),
  );
}

function defaultWorktreeFolder(
  git: GitCommandRunner,
  directory: string,
  worktrees: readonly RepositoryWorktree[],
) {
  const main = worktrees.find((worktree) => worktree.main);
  return (
    main === undefined
      ? readGitCommonDirectory(git, directory)
      : Effect.succeed(main.path)
  ).pipe(
    Effect.map((root) =>
      join(dirname(root), `${basename(root).replace(/\.git$/, "")}.worktrees`),
    ),
  );
}

function rejected(reason: WorktreeRejected["reason"]): WorktreeRejected {
  return { _tag: "WorktreeRejected", reason };
}
