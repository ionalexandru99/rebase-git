import type {
  ChangeDiff,
  MutateChanges,
  RepositoryChanges,
} from "@rebase/contracts";
import { createTwoFilesPatch } from "diff";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryChangesError } from "#server/domain/repository-changes.contract";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import {
  changeGit,
  changesError,
} from "#server/features/repository-changes/git/change-git";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff";
import { selectedChangeText } from "#server/features/repository-changes/patch/selected-change-text";

export function mutateChanges(
  git: GitCommandRunner,
  command: MutateChanges,
  snapshot: RepositoryChanges,
  base: string,
  verify: Effect.Effect<void, RepositoryChangesError>,
) {
  return Effect.gen(function* () {
    if (
      (command.action === "stage" && command.section !== "unstaged") ||
      (command.action === "unstage" && command.section !== "staged")
    )
      return yield* Effect.fail(
        changesError(
          "Unsupported",
          "This action does not match the selected section.",
        ),
      );
    const files = snapshot[command.section];
    const selection = command.selection;
    const paths =
      selection._tag === "All"
        ? files.map((file) => file.path)
        : selection._tag === "Files"
          ? [...new Set(selection.paths)]
          : [selection.path];
    if (paths.length === 0) return;
    for (const path of paths) {
      const file = files.find((file) => file.path === path);
      if (file === undefined)
        return yield* Effect.fail(
          changesError(
            "Stale",
            "A selected file has changed. Refresh the changes and try again.",
          ),
        );
      if (file.status === "U" && command.action !== "stage")
        return yield* Effect.fail(
          changesError(
            "Conflict",
            "Resolve this file's merge conflict before unstaging or discarding it.",
          ),
        );
      yield* safeChangePath(command.worktreePath, path);
    }
    if (selection._tag === "Lines") {
      const diff = yield* readChangeDiff(
        git,
        { ...command, path: selection.path },
        base,
      );
      if (diff.revision !== selection.revision)
        return yield* Effect.fail(
          changesError(
            "Stale",
            "The file changed since these lines were selected. Review the updated diff.",
          ),
        );
      if (diff.kind !== "text")
        return yield* Effect.fail(
          changesError(
            "Unsupported",
            "This file supports whole-file actions only.",
          ),
        );
      const reverse = command.action !== "stage";
      const target = yield* Effect.try({
        try: () =>
          selectedChangeText(
            diff.before ?? "",
            diff.after ?? "",
            selection.lines,
            reverse,
          ),
        catch: () =>
          changesError("Stale", "The selected lines no longer match the file."),
      });
      const current = reverse ? diff.after : diff.before;
      const destination =
        target === "" && (reverse ? diff.before : diff.after) === null
          ? null
          : target;
      const patch = contentPatch(diff, current, destination);
      yield* verify;
      yield* applyChangePatch(git, command, patch);
      return;
    }
    if (command.action === "stage" || command.action === "unstage") {
      yield* pathspecGit(
        git,
        command.worktreePath,
        command.action === "stage"
          ? ["add"]
          : ["restore", `--source=${base}`, "--staged"],
        paths,
      );
      return;
    }
    yield* discardFiles(git, command, snapshot, paths, base, verify);
  });
}

function discardFiles(
  git: GitCommandRunner,
  command: MutateChanges,
  snapshot: RepositoryChanges,
  paths: readonly string[],
  base: string,
  verify: Effect.Effect<void, RepositoryChangesError>,
) {
  return Effect.gen(function* () {
    const directory = command.worktreePath;
    const unstaged = new Map(
      snapshot.unstaged.map((file) => [file.path, file.status]),
    );
    if (command.section === "unstaged") {
      const created = new Set(
        paths.filter((path) => {
          const status = unstaged.get(path);
          return status === "?" || status === "A";
        }),
      );
      const patch = yield* createdFilesPatch(git, directory, [...created]);
      yield* verify;
      yield* applyChangePatch(git, command, patch, true);
      yield* pathspecGit(
        git,
        directory,
        ["restore", "--worktree"],
        paths.filter((path) => !created.has(path)),
      );
      return;
    }
    const edited = paths.filter((path) => unstaged.has(path));
    const patch =
      edited.length === 0
        ? ""
        : yield* changeGit(git, directory, [
            "diff",
            ...patchOptions,
            "--no-renames",
            "--cached",
            base,
            "--",
            ...edited,
          ]);
    yield* verify;
    yield* applyChangePatch(git, command, patch, true);
    yield* pathspecGit(
      git,
      directory,
      ["restore", `--source=${base}`, "--staged", "--worktree"],
      paths.filter((path) => !unstaged.has(path)),
    );
  });
}

const patchOptions = [
  "--binary",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

function createdFilesPatch(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
) {
  return Effect.forEach(paths, (path) =>
    git
      .run({
        directory,
        arguments: [
          "diff",
          "--no-index",
          ...patchOptions,
          "--",
          "/dev/null",
          path,
        ],
      })
      .pipe(
        Effect.mapError(() =>
          changesError(
            "GitFailed",
            "Could not prepare the untracked file for discard.",
          ),
        ),
        Effect.flatMap((output) =>
          output.exitCode === 0 || output.exitCode === 1
            ? Effect.succeed(output.stdout)
            : Effect.fail(changesError("GitFailed", output.stderr)),
        ),
      ),
  ).pipe(Effect.map((patches) => patches.join("\n")));
}

function pathspecGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  paths: readonly string[],
) {
  if (paths.length === 0) return Effect.void;
  return changeGit(
    git,
    directory,
    [...args, "--pathspec-from-file=-", "--pathspec-file-nul"],
    { input: `${paths.join("\0")}\0` },
  ).pipe(Effect.asVoid);
}

function contentPatch(
  diff: ChangeDiff,
  before: string | null,
  after: string | null,
) {
  return createTwoFilesPatch(
    before === null ? "/dev/null" : JSON.stringify(`a/${diff.path}`),
    after === null ? "/dev/null" : JSON.stringify(`b/${diff.path}`),
    before ?? "",
    after ?? "",
    "",
    "",
    { context: 3 },
  );
}

function applyChangePatch(
  git: GitCommandRunner,
  command: MutateChanges,
  patch: string,
  reverse = false,
) {
  if (!patch.trim()) return Effect.void;
  const args = [
    "apply",
    "--whitespace=nowarn",
    ...(reverse ? ["--reverse"] : []),
  ];
  const directory = command.worktreePath;
  const rejected = () =>
    changesError(
      "Conflict",
      "These changes overlap other edits or no longer apply. Nothing was discarded. Refresh the diff and review the overlapping lines.",
    );
  if (command.action === "discard" && command.section === "unstaged") {
    return changeGit(git, directory, args, { input: patch }).pipe(
      Effect.mapError(rejected),
      Effect.asVoid,
    );
  }
  return Effect.gen(function* () {
    yield* changeGit(git, directory, [...args, "--cached"], {
      input: patch,
    }).pipe(Effect.mapError(rejected));
    if (command.action === "discard")
      yield* changeGit(git, directory, args, { input: patch }).pipe(
        Effect.mapError(rejected),
      );
  });
}
