import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { Effect } from "effect";
import {
  type ChangedFile,
  changesFailed,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { SaveStash } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  createdFilesPatch,
  patchOptions,
} from "#server/features/repository-changes/git/mutate-changes.ts";
import { readChanges } from "#server/features/repository-changes/git/read-changes.ts";
import { mutateRepositoryChanges } from "#server/features/repository-changes/repository-changes.ts";
import type { GitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import {
  describeStash,
  dropEntry,
  requireStashIndex,
  stashRejected,
} from "#server/features/repository-stashes/stash-entries.ts";

interface StashSnapshot {
  readonly base: string;
  readonly index: string;
  readonly worktree: string;
  readonly untracked: string | null;
  readonly subject: string | null;
}

export function saveStash(
  git: GitCommandRunner,
  lfs: GitLfs,
  command: SaveStash,
) {
  const directory = command.worktreePath;
  return Effect.gen(function* () {
    const scope = { ...command, amend: false };
    const { snapshot } = yield* readChanges(git, scope);
    if (snapshot.revision !== command.revision)
      return yield* Effect.fail(
        changesFailed(
          "Stale",
          "The repository changed. Review the refreshed changes and try again.",
        ),
      );
    const head = snapshot.head;
    if (head === null) return yield* Effect.fail(stashRejected("Unborn"));
    const files = yield* selectedFiles(
      snapshot[command.section],
      command.paths,
    );
    const target =
      command.into === null
        ? {
            base: head,
            index: head,
            worktree: head,
            untracked: null,
            subject: null,
          }
        : yield* readTarget(git, directory, command.into);
    const patches = yield* readPatches(git, directory, command, head, files);
    const trees = yield* Effect.scoped(
      Effect.gen(function* () {
        const indexFile = yield* temporaryIndex(git, directory);
        const tree = (from: string | null, ...changes: readonly string[]) =>
          buildTree(git, directory, indexFile, from, changes);
        return {
          index: yield* tree(target.index, patches.staged),
          worktree: yield* tree(
            target.worktree,
            patches.staged,
            patches.unstaged,
          ),
          untracked:
            target.untracked === null && patches.untracked === ""
              ? null
              : yield* tree(target.untracked, patches.untracked),
        };
      }),
    );
    const label = yield* baseLabel(git, directory, target);
    const message =
      target.subject ??
      (command.name === undefined
        ? `WIP on ${label.branch}: ${label.commit}`
        : `On ${label.branch}: ${command.name}`);
    const oid = yield* commitStash(git, directory, target, trees, {
      label: `${label.branch}: ${label.commit}`,
      message,
    });
    yield* runRepositoryGit(git, directory, [
      "stash",
      "store",
      "--message",
      message,
      oid,
    ]);
    yield* mutateRepositoryChanges(
      {
        ...scope,
        action: "discard",
        selection: { _tag: "Files", paths: command.paths },
      },
      git,
      lfs,
    ).pipe(
      Effect.tapError(() =>
        requireStashIndex(git, directory, oid).pipe(
          Effect.flatMap((entry) => dropEntry(git, directory, entry)),
          Effect.ignore,
        ),
      ),
    );
    if (command.into !== null) {
      const previous = yield* requireStashIndex(git, directory, command.into);
      yield* dropEntry(git, directory, previous);
    }
    return { oid };
  });
}

function selectedFiles(
  files: readonly ChangedFile[],
  paths: readonly string[],
) {
  const selected = paths.map((path) =>
    files.find((file) => file.path === path),
  );
  if (selected.some((file) => file === undefined))
    return Effect.fail(
      changesFailed(
        "Stale",
        "A selected file has changed. Refresh the changes and try again.",
      ),
    );
  const chosen = selected.filter((file) => file !== undefined);
  if (chosen.some((file) => file.status === "U"))
    return Effect.fail(
      changesFailed(
        "Conflict",
        "Resolve this file's merge conflict before stashing it.",
      ),
    );
  return Effect.succeed(chosen);
}

function readTarget(git: GitCommandRunner, directory: string, oid: string) {
  return Effect.gen(function* () {
    const { subject } = yield* requireStashIndex(git, directory, oid);
    const [base, index, untracked = null] = (yield* runRepositoryGit(
      git,
      directory,
      ["rev-list", "--parents", "--max-count=1", oid, "--"],
    ))
      .trim()
      .split(" ")
      .slice(1);
    if (base === undefined || index === undefined)
      return yield* Effect.fail(stashRejected("DoesNotFit"));
    return {
      base,
      index,
      worktree: oid,
      untracked,
      subject,
    } satisfies StashSnapshot;
  });
}

function readPatches(
  git: GitCommandRunner,
  directory: string,
  command: SaveStash,
  head: string,
  files: readonly ChangedFile[],
) {
  return Effect.gen(function* () {
    const diff = (args: readonly string[], paths: readonly string[]) =>
      paths.length === 0
        ? Effect.succeed("")
        : runRepositoryGit(git, directory, [
            "diff",
            ...patchOptions,
            "--no-renames",
            ...args,
            "--",
            ...paths,
          ]);
    if (command.section === "staged")
      return {
        staged: yield* diff(
          ["--cached", head],
          files.flatMap((file) =>
            file.previousPath === null
              ? [file.path]
              : [file.path, file.previousPath],
          ),
        ),
        unstaged: "",
        untracked: "",
      };
    const created = files.filter((file) => file.status === "?");
    return {
      staged: "",
      unstaged: yield* diff(
        [],
        files.filter((file) => file.status !== "?").map((file) => file.path),
      ),
      untracked: yield* createdFilesPatch(
        git,
        {},
        directory,
        created.map((file) => file.path),
      ),
    };
  });
}

function temporaryIndex(git: GitCommandRunner, directory: string) {
  return Effect.acquireRelease(
    runRepositoryGit(git, directory, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]).pipe(
      Effect.map((index) => `${index.trim()}.rebase-stash-${randomUUID()}`),
    ),
    (path) =>
      Effect.promise(() =>
        Promise.all([
          rm(path, { force: true }),
          rm(`${path}.lock`, { force: true }),
        ]),
      ),
  );
}

function buildTree(
  git: GitCommandRunner,
  directory: string,
  indexFile: string,
  from: string | null,
  patches: readonly string[],
) {
  return Effect.gen(function* () {
    yield* runRepositoryGit(
      git,
      directory,
      from === null
        ? ["read-tree", "--empty"]
        : ["read-tree", `${from}^{tree}`],
      { indexFile },
    );
    for (const patch of patches.filter((text) => text.trim() !== ""))
      yield* runRepositoryGit(
        git,
        directory,
        ["apply", "--cached", "--3way", "--whitespace=nowarn"],
        { indexFile, input: patch },
      ).pipe(Effect.mapError(() => stashRejected("DoesNotFit")));
    return (yield* runRepositoryGit(git, directory, ["write-tree"], {
      indexFile,
    })).trim();
  });
}

function commitStash(
  git: GitCommandRunner,
  directory: string,
  target: StashSnapshot,
  trees: {
    readonly index: string;
    readonly worktree: string;
    readonly untracked: string | null;
  },
  { label, message }: { readonly label: string; readonly message: string },
) {
  return Effect.gen(function* () {
    const commit = (tree: string, text: string, parents: readonly string[]) =>
      runRepositoryGit(git, directory, [
        "commit-tree",
        tree,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        text,
      ]).pipe(Effect.map((oid) => oid.trim()));
    const index = yield* commit(trees.index, `index on ${label}`, [
      target.base,
    ]);
    const untracked =
      trees.untracked === null
        ? null
        : yield* commit(trees.untracked, `untracked files on ${label}`, []);
    return yield* commit(trees.worktree, message, [
      target.base,
      index,
      ...(untracked === null ? [] : [untracked]),
    ]);
  });
}

function baseLabel(
  git: GitCommandRunner,
  directory: string,
  target: StashSnapshot,
) {
  return Effect.gen(function* () {
    const branch =
      target.subject === null
        ? (yield* runRepositoryGit(
            git,
            directory,
            ["symbolic-ref", "--short", "--quiet", "HEAD"],
            { exitCodes: [0, 1] },
          )).trim()
        : (describeStash(target.subject).branch ?? "");
    const commit = (yield* runRepositoryGit(git, directory, [
      "log",
      "-1",
      "--format=%h %s",
      target.base,
      "--",
    ])).trim();
    return { branch: branch === "" ? "(no branch)" : branch, commit };
  });
}
