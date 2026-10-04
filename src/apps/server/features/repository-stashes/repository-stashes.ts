import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type ApplyStash,
  RepositoryStashesApi,
  type StashContents,
  type StashTarget,
} from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { readCommitFiles } from "#server/features/commit-inspection/commit-inspection.ts";
import { saveStash } from "#server/features/repository-stashes/save-stash.ts";
import {
  dropEntry,
  listStashes,
  requireStashIndex,
  stashMissing,
  stashRejected,
} from "#server/features/repository-stashes/stash-entries.ts";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination.ts";

const maximumFiles = 5_000;

const worktreePolicy: RepositoryWritePolicy = {
  name: "stash",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: "block",
};

const dropPolicy: RepositoryWritePolicy = {
  name: "stash",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

export function repositoryStashesFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryStashesApi;
  return {
    routes: [
      query(api.list, (input, git) => listStashes(git, input.worktreePath)),
      query(api.contents, (input, git) => readStashContents(git, input)),
      command(api.apply, worktreePolicy, (input, git) =>
        applyStash(git, input),
      ),
      command(api.drop, dropPolicy, (input, git) => dropStash(git, input)),
      command(api.save, worktreePolicy, (input, git) => saveStash(git, input)),
    ],
  };
}

export function readStashContents(git: GitCommandRunner, target: StashTarget) {
  return Effect.gen(function* () {
    const parents = yield* runRepositoryGitOutput(
      git,
      target.worktreePath,
      ["rev-list", "--parents", "--max-count=1", target.oid, "--"],
      { exitCodes: [0, 128] },
    ).pipe(
      Effect.map((output) =>
        output.exitCode === 0 ? output.stdout.trim().split(" ").slice(1) : [],
      ),
    );
    const [base, , untracked = null] = parents;
    if (base === undefined) return yield* Effect.fail(stashMissing());
    const tracked = yield* readCommitFiles(git, target, base);
    const added =
      untracked === null
        ? []
        : yield* readCommitFiles(git, { ...target, oid: untracked }, null);
    const files = [
      ...tracked.map((file) => ({ ...file, untracked: false })),
      ...added.map((file) => ({ ...file, untracked: true })),
    ];
    return {
      base,
      untracked,
      files: files.slice(0, maximumFiles),
      truncated: files.length > maximumFiles,
    } satisfies StashContents;
  });
}

export function applyStash(git: GitCommandRunner, command: ApplyStash) {
  const { worktreePath, oid } = command;
  return Effect.gen(function* () {
    yield* requireStashIndex(git, worktreePath, oid);
    const applied = yield* runRepositoryGitOutput(
      git,
      worktreePath,
      ["stash", "apply", ...(command.restoreIndex ? ["--index"] : []), oid],
      { exitCodes: [0, 1, 128], timeoutMilliseconds: 120_000 },
    );
    const conflicts =
      applied.exitCode === 0 ? 0 : yield* countConflicts(git, worktreePath);
    if (applied.exitCode !== 0 && conflicts === 0)
      return yield* Effect.fail(applyRefused(applied.stderr));
    if (command.drop && conflicts === 0) yield* dropStash(git, command);
    else yield* moveToTop(git, worktreePath, oid);
    return { conflicts };
  });
}

export function dropStash(git: GitCommandRunner, target: StashTarget) {
  return requireStashIndex(git, target.worktreePath, target.oid).pipe(
    Effect.flatMap((entry) => dropEntry(git, target.worktreePath, entry)),
    Effect.as({}),
  );
}

function moveToTop(git: GitCommandRunner, directory: string, oid: string) {
  return Effect.gen(function* () {
    const entry = yield* requireStashIndex(git, directory, oid);
    if (entry.index === 0) return;
    yield* runRepositoryGit(git, directory, [
      "stash",
      "store",
      "--message",
      entry.subject,
      oid,
    ]);
    yield* dropEntry(git, directory, { index: entry.index + 1 });
  });
}

function countConflicts(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z",
  ]).pipe(
    Effect.map(
      (output) => output.split("\0").filter((path) => path.length > 0).length,
    ),
  );
}

function applyRefused(detail: string) {
  if (/Conflicts in index/i.test(detail)) return stashRejected("IndexConflict");
  if (
    /would be overwritten|already exists|could not restore untracked/i.test(
      detail,
    )
  )
    return stashRejected("LocalChanges");
  return repositoryRejected("GitFailed", detail.trim());
}
