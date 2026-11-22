import {
  type ChangesMutated,
  type ChangesScope,
  type ChangesWritten,
  type CommitChanges,
  changesFailed,
  type IgnorePaths,
  type MutateChanges,
  type ReadChangeDiff,
  type RepositoryChanges,
  RepositoryChangesApi,
  type UndoDiscard,
  type ViewedChange,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
  uninterruptible,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  safeChangePath,
  worktreeIdentities,
} from "#server/features/repository-changes/git/change-files.ts";
import { withChangeIndex } from "#server/features/repository-changes/git/change-index.ts";
import {
  restoreDiscarded,
  snapshotChanges,
} from "#server/features/repository-changes/git/discard-snapshot.ts";
import {
  ignorePaths,
  readIgnoreRule,
} from "#server/features/repository-changes/git/ignore-paths.ts";
import { planChanges } from "#server/features/repository-changes/git/mutate-changes.ts";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff.ts";
import {
  readChanges,
  readComparisonBase,
  readStagedPreviousPath,
} from "#server/features/repository-changes/git/read-changes.ts";
import type { GitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import { atRebaseEditStop } from "#server/repository/repository-coordination.ts";

export async function readRepositoryChanges(
  scope: ChangesScope,
  git: GitCommandRunner,
) {
  return (await readChanges(git, scope)).snapshot;
}

export async function readRepositoryChangeDiff(
  command: ReadChangeDiff,
  git: GitCommandRunner,
) {
  await safeChangePath(command.worktreePath, command.path);
  const base = await readComparisonBase(git, command);
  const previousPath =
    command.section === "unstaged"
      ? null
      : await readStagedPreviousPath(
          git,
          command.worktreePath,
          base,
          command.path,
        );
  return readChangeDiff(git, command, { base, previousPath });
}

export async function mutateRepositoryChanges(
  command: MutateChanges,
  git: GitCommandRunner,
  lfs: GitLfs,
) {
  const directory = command.worktreePath;
  const discarded = await withChangeIndex(git, directory, async (indexFile) => {
    const current = await verifyChanges(git, command);
    const unchanged = () => verifyChangedFiles(directory, current.files);
    const { touched, apply } = await planChanges(
      git,
      { indexFile },
      command,
      current,
      unchanged,
      await lfs.installed(),
    );
    if (command.action !== "discard") {
      await apply();
      await unchanged();
      return null;
    }
    const capture = () =>
      snapshotChanges(git, directory, indexFile, {
        paths: touched,
        conflicted: conflictedPaths(current.snapshot),
      });
    const before = await capture();
    await apply();
    return { before, after: await capture() };
  });
  const written = await readWritten(git, command, command.viewed);
  return { ...written, discarded } satisfies ChangesMutated;
}

export async function undoRepositoryDiscard(
  command: UndoDiscard,
  git: GitCommandRunner,
) {
  await withChangeIndex(git, command.worktreePath, (indexFile) =>
    restoreDiscarded(git, command.worktreePath, indexFile, command.discarded),
  );
  return readWritten(git, command, command.viewed);
}

export async function ignoreRepositoryPaths(
  command: IgnorePaths,
  git: GitCommandRunner,
) {
  await withChangeIndex(git, command.worktreePath, (indexFile) =>
    ignorePaths(git, { indexFile }, command),
  );
  return readWritten(git, command, command.viewed);
}

export async function commitRepositoryChanges(
  command: CommitChanges,
  git: GitCommandRunner,
  lfs: GitLfs,
) {
  await withChangeIndex(git, command.worktreePath, async (indexFile) => {
    const current = await verifyChanges(git, command);
    requireCommittable(command, current.snapshot);
    if (!command.amend && current.snapshot.staged.length === 0)
      await stageEverything(
        git,
        indexFile,
        command,
        current,
        await lfs.installed(),
      );
    await uninterruptible(() =>
      runRepositoryGit(
        git,
        command.worktreePath,
        [
          "commit",
          ...(command.amend ? ["--amend", "--allow-empty"] : []),
          "--file=-",
        ],
        {
          globalArguments: ["-c", "user.useConfigOnly=true"],
          indexFile,
          input: command.message,
          timeoutMilliseconds: 120_000,
        },
      ),
    );
  });
  return readWritten(git, { ...command, amend: false }, command.viewed);
}

async function stageEverything(
  git: GitCommandRunner,
  indexFile: string,
  command: CommitChanges,
  current: Awaited<ReturnType<typeof verifyChanges>>,
  lfsInstalled: boolean,
) {
  const unchanged = () =>
    verifyChangedFiles(command.worktreePath, current.files);
  const { apply } = await planChanges(
    git,
    { indexFile },
    {
      repositoryId: command.repositoryId,
      worktreePath: command.worktreePath,
      amend: false,
      revision: command.revision,
      action: "stage",
      section: "unstaged",
      selection: { _tag: "All" },
    },
    current,
    unchanged,
    lfsInstalled,
  );
  await apply();
  await unchanged();
}

function requireCommittable(
  command: CommitChanges,
  snapshot: RepositoryChanges,
) {
  if (!command.message.trim())
    throw changesFailed("Unsupported", "Write a commit message first.");
  if (!command.amend && snapshot.staged.length + snapshot.unstaged.length === 0)
    throw changesFailed("Unsupported", "There is nothing to commit.");
  if (
    [...snapshot.unstaged, ...snapshot.staged].some(
      (file) => file.status === "U",
    )
  )
    throw changesFailed(
      "Conflict",
      "Resolve all merge conflicts before committing.",
    );
}

async function readWritten(
  git: GitCommandRunner,
  scope: ChangesScope,
  viewed: ViewedChange | undefined,
) {
  const { snapshot, base } = await readChanges(git, scope);
  const file =
    viewed &&
    snapshot[viewed.section].find((file) => file.path === viewed.path);
  const diff =
    viewed && file
      ? await readChangeDiff(
          git,
          {
            repositoryId: scope.repositoryId,
            worktreePath: scope.worktreePath,
            amend: scope.amend,
            ...viewed,
          },
          { base, previousPath: file.previousPath },
        ).catch((error) => {
          if (error instanceof Error) throw error;
          return null;
        })
      : null;
  return { changes: snapshot, diff } satisfies ChangesWritten;
}

function conflictedPaths(snapshot: RepositoryChanges) {
  return [
    ...new Set(
      [...snapshot.unstaged, ...snapshot.staged]
        .filter((file) => file.status === "U")
        .map((file) => file.path),
    ),
  ];
}

async function verifyChanges(
  git: GitCommandRunner,
  scope: ChangesScope & { readonly revision: string },
) {
  const current = await readChanges(git, scope);
  if (current.snapshot.revision !== scope.revision) throw staleChanges();
  return current;
}

async function verifyChangedFiles(
  directory: string,
  files: {
    readonly paths: readonly string[];
    readonly identities: readonly string[];
  },
) {
  const identities = await worktreeIdentities(directory, files.paths);
  if (
    !identities.every((identity, index) => identity === files.identities[index])
  )
    throw staleChanges();
}

function staleChanges() {
  return changesFailed(
    "Stale",
    "The repository changed. Review the refreshed changes and try again.",
  );
}

export function repositoryChangesFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryChangesApi;
  return {
    routes: [
      query(api.read, readRepositoryChanges),
      query(api.diff, readRepositoryChangeDiff),
      query(api.ignoreRule, (input, git) => readIgnoreRule(git, input)),
      command(
        api.mutate,
        (input) => ({
          name: input.action,
          locks: { worktree: "wait" },
          duringOperation:
            input.action === "discard"
              ? "block"
              : { allowWhen: (operation) => operation.kind !== "unknown" },
        }),
        (input, git) => mutateRepositoryChanges(input, git, dependencies.lfs),
      ),
      command(
        api.undoDiscard,
        () => ({
          name: "undo the discard",
          locks: { worktree: "wait" },
          duringOperation: "block",
        }),
        undoRepositoryDiscard,
      ),
      command(
        api.ignore,
        () => ({
          name: "ignore",
          locks: { worktree: "wait" },
          duringOperation: {
            allowWhen: (operation) => operation.kind !== "unknown",
          },
        }),
        ignoreRepositoryPaths,
      ),
      command(
        api.commit,
        (input) => ({
          name: input.amend ? "amend" : "commit",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: atRebaseEditStop,
        }),
        (input, git) => commitRepositoryChanges(input, git, dependencies.lfs),
      ),
    ],
  };
}
