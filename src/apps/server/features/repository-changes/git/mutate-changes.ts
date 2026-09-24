import type {
  ChangeDiff,
  MutateChanges,
  RepositoryChanges,
} from "@rebase/contracts";
import { createTwoFilesPatch } from "diff";
import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { changesError } from "#server/features/repository-changes/git/change-failures";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff";
import { selectedChangeText } from "#server/features/repository-changes/patch/selected-change-text";
import { runRepositoryGit } from "#server/repository/access/index";

export function mutateChanges<E>(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: MutateChanges,
  { snapshot, base }: { snapshot: RepositoryChanges; base: string },
  verify: Effect.Effect<void, E>,
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
    const sources = renameSources(files, paths);
    if (selection._tag === "Lines") {
      const diff = yield* readChangeDiff(
        git,
        { ...command, path: selection.path },
        { base, previousPath: sources[0] ?? null },
        index,
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
      yield* applyChangePatch(git, index, command, patch);
      return;
    }
    if (command.action === "stage" || command.action === "unstage") {
      yield* pathspecGit(
        git,
        index,
        command.worktreePath,
        command.action === "stage"
          ? ["add"]
          : ["restore", `--source=${base}`, "--staged"],
        [...paths, ...sources],
      );
      return;
    }
    yield* discardFiles(
      git,
      index,
      command,
      { snapshot, base },
      { paths, sources },
      verify,
    );
  });
}

function discardFiles<E>(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: MutateChanges,
  { snapshot, base }: { snapshot: RepositoryChanges; base: string },
  { paths, sources }: { paths: readonly string[]; sources: readonly string[] },
  verify: Effect.Effect<void, E>,
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
      const patch = yield* createdFilesPatch(git, index, directory, [
        ...created,
      ]);
      yield* verify;
      yield* applyChangePatch(git, index, command, patch, true);
      yield* pathspecGit(
        git,
        index,
        directory,
        ["restore", "--worktree"],
        paths.filter((path) => !created.has(path)),
      );
      return;
    }
    if (sources.some((path) => unstaged.has(path)))
      return yield* Effect.fail(
        changesError(
          "Conflict",
          "A new file exists at the renamed file's original path. Move it before discarding the rename.",
        ),
      );
    const edited = paths.filter((path) => unstaged.has(path));
    const patch =
      edited.length === 0
        ? ""
        : yield* runRepositoryGit(
            git,
            directory,
            [
              "diff",
              ...patchOptions,
              "--no-renames",
              "--cached",
              base,
              "--",
              ...edited,
            ],
            index,
          );
    yield* verify;
    yield* applyChangePatch(git, index, command, patch, true);
    const restore = ["restore", `--source=${base}`, "--staged", "--worktree"];
    yield* pathspecGit(
      git,
      index,
      directory,
      restore,
      paths.filter((path) => !unstaged.has(path)),
    );
    yield* pathspecGit(git, index, directory, restore, sources);
  });
}

function renameSources(
  files: RepositoryChanges["staged"],
  paths: readonly string[],
) {
  const selected = new Set(paths);
  return files.flatMap((file) =>
    file.previousPath !== null && selected.has(file.path)
      ? [file.previousPath]
      : [],
  );
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
  index: GitCommandOptions,
  directory: string,
  paths: readonly string[],
) {
  return Effect.forEach(paths, (path) =>
    runRepositoryGit(
      git,
      directory,
      ["diff", "--no-index", ...patchOptions, "--", "/dev/null", path],
      { ...index, exitCodes: [0, 1] },
    ),
  ).pipe(Effect.map((patches) => patches.join("\n")));
}

function pathspecGit(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  args: readonly string[],
  paths: readonly string[],
) {
  if (paths.length === 0) return Effect.void;
  return runRepositoryGit(
    git,
    directory,
    [...args, "--pathspec-from-file=-", "--pathspec-file-nul"],
    { ...index, input: `${paths.join("\0")}\0` },
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
  index: GitCommandOptions,
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
    return runRepositoryGit(git, directory, args, {
      ...index,
      input: patch,
    }).pipe(Effect.mapError(rejected), Effect.asVoid);
  }
  return Effect.gen(function* () {
    yield* runRepositoryGit(git, directory, [...args, "--cached"], {
      ...index,
      input: patch,
    }).pipe(Effect.mapError(rejected));
    if (command.action === "discard")
      yield* runRepositoryGit(git, directory, args, {
        ...index,
        input: patch,
      }).pipe(Effect.mapError(rejected));
  });
}
