import { Effect } from "effect";
import {
  type ChangesMutated,
  type ChangesScope,
  type ChangesWritten,
  type CommitChanges,
  changesFailed,
  type MutateChanges,
  type ReadChangeDiff,
  type RepositoryChanges,
  RepositoryChangesApi,
  type UndoDiscard,
  type ViewedChange,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type RepositoryDependencies,
  repositoryRoutes,
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
import { planChanges } from "#server/features/repository-changes/git/mutate-changes.ts";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff.ts";
import { readChanges } from "#server/features/repository-changes/git/read-changes.ts";
import { atRebaseEditStop } from "#server/repository/repository-coordination.ts";

export function readRepositoryChanges(
  scope: ChangesScope,
  git: GitCommandRunner,
) {
  return readChanges(git, scope).pipe(Effect.map((value) => value.snapshot));
}

export function readRepositoryChangeDiff(
  command: ReadChangeDiff,
  git: GitCommandRunner,
) {
  return Effect.gen(function* () {
    yield* safeChangePath(command.worktreePath, command.path);
    const { snapshot, base } = yield* readChanges(git, command);
    return yield* readChangeDiff(git, command, {
      base,
      previousPath: previousPathOf(snapshot, command),
    });
  });
}

export function mutateRepositoryChanges(
  command: MutateChanges,
  git: GitCommandRunner,
) {
  const directory = command.worktreePath;
  return Effect.gen(function* () {
    const discarded = yield* withChangeIndex(git, directory, (indexFile) =>
      Effect.gen(function* () {
        const current = yield* verifyChanges(git, command);
        const unchanged = verifyChangedFiles(directory, current.files);
        const { touched, apply } = yield* planChanges(
          git,
          { indexFile },
          command,
          current,
          unchanged,
        );
        if (command.action !== "discard")
          return yield* apply.pipe(Effect.andThen(unchanged), Effect.as(null));
        const capture = snapshotChanges(git, directory, indexFile, {
          paths: touched,
          conflicted: conflictedPaths(current.snapshot),
        });
        const before = yield* capture;
        yield* apply;
        return { before, after: yield* capture };
      }),
    );
    const written = yield* readWritten(git, command, command.viewed);
    return { ...written, discarded } satisfies ChangesMutated;
  });
}

export function undoRepositoryDiscard(
  command: UndoDiscard,
  git: GitCommandRunner,
) {
  return withChangeIndex(git, command.worktreePath, (indexFile) =>
    restoreDiscarded(git, command.worktreePath, indexFile, command.discarded),
  ).pipe(Effect.andThen(() => readWritten(git, command, command.viewed)));
}

export function commitRepositoryChanges(
  command: CommitChanges,
  git: GitCommandRunner,
) {
  return withChangeIndex(git, command.worktreePath, (indexFile) =>
    Effect.gen(function* () {
      const { snapshot } = yield* verifyChanges(git, command);
      yield* requireCommittable(command, snapshot);
      if (!command.amend && snapshot.staged.length === 0)
        yield* runRepositoryGit(git, command.worktreePath, ["add", "--all"], {
          indexFile,
        });
      yield* Effect.uninterruptible(
        runRepositoryGit(
          git,
          command.worktreePath,
          [
            "commit",
            ...(command.amend ? ["--amend", "--allow-empty"] : []),
            "--file=-",
          ],
          {
            indexFile,
            input: command.message,
            timeoutMilliseconds: 120_000,
          },
        ),
      );
    }),
  ).pipe(
    Effect.andThen(() =>
      readWritten(git, { ...command, amend: false }, command.viewed),
    ),
  );
}

function requireCommittable(
  command: CommitChanges,
  snapshot: RepositoryChanges,
) {
  if (!command.message.trim())
    return Effect.fail(
      changesFailed("Unsupported", "Write a commit message first."),
    );
  if (!command.amend && snapshot.staged.length + snapshot.unstaged.length === 0)
    return Effect.fail(
      changesFailed("Unsupported", "There is nothing to commit."),
    );
  if (
    [...snapshot.unstaged, ...snapshot.staged].some(
      (file) => file.status === "U",
    )
  )
    return Effect.fail(
      changesFailed(
        "Conflict",
        "Resolve all merge conflicts before committing.",
      ),
    );
  return Effect.void;
}

function readWritten(
  git: GitCommandRunner,
  scope: ChangesScope,
  viewed: ViewedChange | undefined,
) {
  return Effect.gen(function* () {
    const { snapshot, base } = yield* readChanges(git, scope);
    const file =
      viewed &&
      snapshot[viewed.section].find((file) => file.path === viewed.path);
    const diff =
      viewed && file
        ? yield* readChangeDiff(
            git,
            {
              repositoryId: scope.repositoryId,
              worktreePath: scope.worktreePath,
              amend: scope.amend,
              ...viewed,
            },
            { base, previousPath: file.previousPath },
          ).pipe(Effect.catch(() => Effect.succeed(null)))
        : null;
    return { changes: snapshot, diff } satisfies ChangesWritten;
  });
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

function previousPathOf(snapshot: RepositoryChanges, viewed: ViewedChange) {
  return (
    snapshot[viewed.section].find((file) => file.path === viewed.path)
      ?.previousPath ?? null
  );
}

function verifyChanges(
  git: GitCommandRunner,
  scope: ChangesScope & { readonly revision: string },
) {
  return readChanges(git, scope).pipe(
    Effect.flatMap((current) =>
      current.snapshot.revision === scope.revision
        ? Effect.succeed(current)
        : Effect.fail(staleChanges()),
    ),
  );
}

function verifyChangedFiles(
  directory: string,
  files: {
    readonly paths: readonly string[];
    readonly identities: readonly string[];
  },
) {
  return worktreeIdentities(directory, files.paths).pipe(
    Effect.flatMap((identities) =>
      identities.every(
        (identity, index) => identity === files.identities[index],
      )
        ? Effect.void
        : Effect.fail(staleChanges()),
    ),
  );
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
        mutateRepositoryChanges,
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
        api.commit,
        (input) => ({
          name: input.amend ? "amend" : "commit",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: atRebaseEditStop,
        }),
        commitRepositoryChanges,
      ),
    ],
  };
}
