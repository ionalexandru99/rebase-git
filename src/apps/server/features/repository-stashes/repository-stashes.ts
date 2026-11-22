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
      command(api.save, worktreePolicy, (input, git) =>
        saveStash(git, dependencies.lfs, input),
      ),
    ],
  };
}

export async function readStashContents(
  git: GitCommandRunner,
  target: StashTarget,
) {
  const output = await runRepositoryGitOutput(
    git,
    target.worktreePath,
    ["rev-list", "--parents", "--max-count=1", target.oid, "--"],
    { exitCodes: [0, 128] },
  );
  const parents =
    output.exitCode === 0 ? output.stdout.trim().split(" ").slice(1) : [];
  const [base, , untracked = null] = parents;
  if (base === undefined) throw stashMissing();
  const tracked = await readCommitFiles(git, target, base);
  const added =
    untracked === null
      ? []
      : await readCommitFiles(git, { ...target, oid: untracked }, null);
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
}

export async function applyStash(git: GitCommandRunner, command: ApplyStash) {
  const { worktreePath, oid } = command;
  await requireStashIndex(git, worktreePath, oid);
  const applied = await runRepositoryGitOutput(
    git,
    worktreePath,
    ["stash", "apply", ...(command.restoreIndex ? ["--index"] : []), oid],
    { exitCodes: [0, 1, 128], timeoutMilliseconds: 120_000 },
  );
  const conflicts =
    applied.exitCode === 0 ? 0 : await countConflicts(git, worktreePath);
  if (applied.exitCode !== 0 && conflicts === 0)
    throw applyRefused(applied.stderr);
  if (command.drop && conflicts === 0) await dropStash(git, command);
  else await moveToTop(git, worktreePath, oid);
  return { conflicts };
}

export async function dropStash(git: GitCommandRunner, target: StashTarget) {
  const entry = await requireStashIndex(git, target.worktreePath, target.oid);
  await dropEntry(git, target.worktreePath, entry);
  return {};
}

async function moveToTop(
  git: GitCommandRunner,
  directory: string,
  oid: string,
) {
  const entry = await requireStashIndex(git, directory, oid);
  if (entry.index === 0) return;
  await runRepositoryGit(git, directory, [
    "stash",
    "store",
    "--message",
    entry.subject,
    oid,
  ]);
  await dropEntry(git, directory, { index: entry.index + 1 });
}

async function countConflicts(git: GitCommandRunner, directory: string) {
  const output = await runRepositoryGit(git, directory, [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z",
  ]);
  return output.split("\0").filter((path) => path.length > 0).length;
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
