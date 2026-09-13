import type {
  ChangeDiff,
  MutateChanges,
  RepositoryChanges,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
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
      yield* changeGit(
        git,
        command.worktreePath,
        command.action === "stage"
          ? ["add", "--pathspec-from-file=-", "--pathspec-file-nul"]
          : [
              "restore",
              `--source=${base}`,
              "--staged",
              "--pathspec-from-file=-",
              "--pathspec-file-nul",
            ],
        { input: `${paths.join("\0")}\0` },
      );
      return;
    }
    const untracked = new Set(
      snapshot.unstaged
        .filter((file) => file.status === "?")
        .map((file) => file.path),
    );
    const removed =
      command.section === "unstaged"
        ? paths.filter((path) => untracked.has(path))
        : [];
    const tracked = paths.filter((path) => !removed.includes(path));
    const patches: string[] = [];
    if (tracked.length > 0) {
      const patch = yield* changeGit(git, command.worktreePath, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--binary",
        ...(command.section === "staged" ? ["--cached", base] : []),
        "--",
        ...tracked,
      ]);
      patches.push(patch);
    }
    for (const path of removed) {
      const output = yield* git
        .run({
          directory: command.worktreePath,
          arguments: [
            "diff",
            "--no-index",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
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
        );
      if (output.exitCode !== 0 && output.exitCode !== 1)
        return yield* Effect.fail(changesError("GitFailed", output.stderr));
      patches.push(output.stdout);
    }
    yield* verify;
    yield* applyChangePatch(git, command, patches.join("\n"), true);
  });
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
