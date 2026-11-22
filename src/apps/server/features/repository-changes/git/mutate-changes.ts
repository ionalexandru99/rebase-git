import { createTwoFilesPatch, diffLines } from "diff";
import {
  changesFailed,
  type MutateChanges,
  type RepositoryChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import {
  type GitCommandOptions,
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { safeChangePath } from "#server/features/repository-changes/git/change-files.ts";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff.ts";

type Verify = () => Promise<void>;

export async function planChanges(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: MutateChanges,
  { snapshot, base }: { snapshot: RepositoryChanges; base: string },
  verify: Verify,
  lfsInstalled: boolean,
) {
  if (
    (command.action === "stage" && command.section !== "unstaged") ||
    (command.action === "unstage" && command.section !== "staged")
  )
    throw changesFailed(
      "Unsupported",
      "This action does not match the selected section.",
    );
  const files = snapshot[command.section];
  const selection = command.selection;
  const paths =
    selection._tag === "All"
      ? files.map((file) => file.path)
      : selection._tag === "Files"
        ? [...new Set(selection.paths)]
        : [selection.path];
  if (paths.length === 0) return { touched: [], apply: async () => {} };
  for (const path of paths) {
    const file = files.find((file) => file.path === path);
    if (file === undefined)
      throw changesFailed(
        "Stale",
        "A selected file has changed. Refresh the changes and try again.",
      );
    if (file.lfs && !lfsInstalled && command.action !== "unstage")
      throw changesFailed(
        "Unsupported",
        "Git LFS isn't installed on this server.",
      );
    if (file.status === "U" && command.action !== "stage")
      throw changesFailed(
        "Conflict",
        "Resolve this file's merge conflict before unstaging or discarding it.",
      );
    await safeChangePath(command.worktreePath, path);
  }
  const sources = renameSources(files, paths);
  return {
    touched: [...paths, ...sources],
    apply: () =>
      applyMutation(
        git,
        index,
        command,
        { snapshot, base },
        { paths, sources },
        verify,
      ),
  };
}

async function applyMutation(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: MutateChanges,
  { snapshot, base }: { snapshot: RepositoryChanges; base: string },
  { paths, sources }: { paths: readonly string[]; sources: readonly string[] },
  verify: Verify,
) {
  const selection = command.selection;
  if (selection._tag === "Lines") {
    const diff = await readChangeDiff(
      git,
      { ...command, path: selection.path, whole: true },
      { base, previousPath: sources[0] ?? null },
      index,
    );
    if (diff.revision !== selection.revision)
      throw changesFailed(
        "Stale",
        "The file changed since these lines were selected. Review the updated diff.",
      );
    if (diff.kind !== "text")
      throw changesFailed(
        "Unsupported",
        "This file supports whole-file actions only.",
      );
    const reverse = command.action !== "stage";
    const target = selectedLinesText(diff, selection.lines, reverse);
    const current = reverse ? diff.after : diff.before;
    const destination =
      target === "" && (reverse ? diff.before : diff.after) === null
        ? null
        : target;
    const patch = contentPatch(diff, current, destination);
    await verify();
    await applyChangePatch(git, index, command, patch);
    return;
  }
  if (command.action === "stage" || command.action === "unstage") {
    await pathspecGit(
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
  await discardFiles(
    git,
    index,
    command,
    { snapshot, base },
    { paths, sources },
    verify,
  );
}

function selectedLinesText(
  diff: ChangeDiff,
  lines: readonly string[],
  reverse: boolean,
) {
  try {
    return selectedChangeText(
      diff.before ?? "",
      diff.after ?? "",
      lines,
      reverse,
    );
  } catch {
    throw changesFailed(
      "Stale",
      "The selected lines no longer match the file.",
    );
  }
}

async function discardFiles(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: MutateChanges,
  { snapshot, base }: { snapshot: RepositoryChanges; base: string },
  { paths, sources }: { paths: readonly string[]; sources: readonly string[] },
  verify: Verify,
) {
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
    const patch = await createdFilesPatch(git, index, directory, [...created]);
    await verify();
    await applyChangePatch(git, index, command, patch, true);
    await pathspecGit(
      git,
      index,
      directory,
      ["restore", "--worktree"],
      paths.filter((path) => !created.has(path)),
    );
    return;
  }
  if (sources.some((path) => unstaged.has(path)))
    throw changesFailed(
      "Conflict",
      "A new file exists at the renamed file's original path. Move it before discarding the rename.",
    );
  const edited = paths.filter((path) => unstaged.has(path));
  const patch =
    edited.length === 0
      ? ""
      : await runRepositoryGit(
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
  await verify();
  await applyChangePatch(git, index, command, patch, true);
  const restore = ["restore", `--source=${base}`, "--staged", "--worktree"];
  await pathspecGit(
    git,
    index,
    directory,
    restore,
    paths.filter((path) => !unstaged.has(path)),
  );
  await pathspecGit(git, index, directory, restore, sources);
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

export const patchOptions = [
  "--binary",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

export async function createdFilesPatch(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  paths: readonly string[],
) {
  const patches: string[] = [];
  for (const path of paths)
    patches.push(
      await runRepositoryGit(
        git,
        directory,
        ["diff", "--no-index", ...patchOptions, "--", "/dev/null", path],
        { ...index, exitCodes: [0, 1] },
      ),
    );
  return patches.join("\n");
}

async function pathspecGit(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  args: readonly string[],
  paths: readonly string[],
) {
  if (paths.length === 0) return;
  await runRepositoryGit(
    git,
    directory,
    [...args, "--pathspec-from-file=-", "--pathspec-file-nul"],
    { ...index, input: `${paths.join("\0")}\0` },
  );
}

function contentPatch(
  diff: ChangeDiff,
  before: string | null,
  after: string | null,
) {
  return createTwoFilesPatch(
    before === null ? "/dev/null" : `a/${diff.path}`,
    after === null ? "/dev/null" : `b/${diff.path}`,
    before ?? "",
    after ?? "",
    "",
    "",
    { context: 3 },
  );
}

async function applyChangePatch(
  git: GitCommandRunner,
  index: GitCommandOptions,
  command: MutateChanges,
  patch: string,
  reverse = false,
) {
  if (!patch.trim()) return;
  const args = [
    "apply",
    "--whitespace=nowarn",
    ...(reverse ? ["--reverse"] : []),
  ];
  const apply = (extra: readonly string[]) =>
    runRepositoryGit(git, command.worktreePath, [...args, ...extra], {
      ...index,
      input: patch,
    }).catch((error) => {
      throw isGitFailed(error)
        ? changesFailed(
            "Conflict",
            "These changes overlap other edits or no longer apply. Nothing was discarded. Refresh the diff and review the overlapping lines.",
          )
        : error;
    });
  if (command.action === "discard" && command.section === "unstaged") {
    await apply([]);
    return;
  }
  await apply(["--cached"]);
  if (command.action === "discard") await apply([]);
}

export function selectedChangeText(
  before: string,
  after: string,
  lines: readonly string[],
  reverse: boolean,
) {
  const selected = new Set(lines);
  const found = new Set<string>();
  const output: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of diffLines(before, after)) {
    for (const line of change.value.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const id = change.removed ? `-${oldLine}` : `+${newLine}`;
      const changed = change.added || change.removed;
      const chosen = changed && selected.has(id);
      if (chosen) found.add(id);
      if (
        !changed ||
        (reverse
          ? change.removed
            ? chosen
            : !chosen
          : change.added
            ? chosen
            : !chosen)
      )
        output.push(line);
      if (!change.added) oldLine++;
      if (!change.removed) newLine++;
    }
  }
  if (found.size !== selected.size || found.size === 0)
    throw new Error(
      "The selected lines have changed. Refresh the diff and select them again.",
    );
  return output.join("");
}
