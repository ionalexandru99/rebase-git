import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  type ChangedFile,
  changesFailed,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { SaveStash } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
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

export async function saveStash(
  git: GitCommandRunner,
  lfs: GitLfs,
  command: SaveStash,
) {
  const directory = command.worktreePath;
  const scope = { ...command, amend: false };
  const { snapshot } = await readChanges(git, scope);
  if (snapshot.revision !== command.revision)
    throw changesFailed(
      "Stale",
      "The repository changed. Review the refreshed changes and try again.",
    );
  const head = snapshot.head;
  if (head === null) throw stashRejected("Unborn");
  const files = selectedFiles(snapshot[command.section], command.paths);
  const target =
    command.into === null
      ? {
          base: head,
          index: head,
          worktree: head,
          untracked: null,
          subject: null,
        }
      : await readTarget(git, directory, command.into);
  const patches = await readPatches(git, directory, command, head, files);
  const trees = await withTemporaryIndex(git, directory, async (indexFile) => {
    const tree = (from: string | null, ...changes: readonly string[]) =>
      buildTree(git, directory, indexFile, from, changes);
    return {
      index: await tree(target.index, patches.staged),
      worktree: await tree(target.worktree, patches.staged, patches.unstaged),
      untracked:
        target.untracked === null && patches.untracked === ""
          ? null
          : await tree(target.untracked, patches.untracked),
    };
  });
  const label = await baseLabel(git, directory, target);
  const message =
    target.subject ??
    (command.name === undefined
      ? `WIP on ${label.branch}: ${label.commit}`
      : `On ${label.branch}: ${command.name}`);
  const oid = await commitStash(git, directory, target, trees, {
    label: `${label.branch}: ${label.commit}`,
    message,
  });
  await runRepositoryGit(git, directory, [
    "stash",
    "store",
    "--message",
    message,
    oid,
  ]);
  try {
    await mutateRepositoryChanges(
      {
        ...scope,
        action: "discard",
        selection: { _tag: "Files", paths: command.paths },
      },
      git,
      lfs,
    );
  } catch (error) {
    if (!(error instanceof Error))
      await requireStashIndex(git, directory, oid)
        .then((entry) => dropEntry(git, directory, entry))
        .catch(() => undefined);
    throw error;
  }
  if (command.into !== null) {
    const previous = await requireStashIndex(git, directory, command.into);
    await dropEntry(git, directory, previous);
  }
  return { oid };
}

function selectedFiles(
  files: readonly ChangedFile[],
  paths: readonly string[],
) {
  const selected = paths.map((path) =>
    files.find((file) => file.path === path),
  );
  if (selected.some((file) => file === undefined))
    throw changesFailed(
      "Stale",
      "A selected file has changed. Refresh the changes and try again.",
    );
  const chosen = selected.filter((file) => file !== undefined);
  if (chosen.some((file) => file.status === "U"))
    throw changesFailed(
      "Conflict",
      "Resolve this file's merge conflict before stashing it.",
    );
  return chosen;
}

async function readTarget(
  git: GitCommandRunner,
  directory: string,
  oid: string,
) {
  const { subject } = await requireStashIndex(git, directory, oid);
  const [base, index, untracked = null] = (
    await runRepositoryGit(git, directory, [
      "rev-list",
      "--parents",
      "--max-count=1",
      oid,
      "--",
    ])
  )
    .trim()
    .split(" ")
    .slice(1);
  if (base === undefined || index === undefined)
    throw stashRejected("DoesNotFit");
  return {
    base,
    index,
    worktree: oid,
    untracked,
    subject,
  } satisfies StashSnapshot;
}

async function readPatches(
  git: GitCommandRunner,
  directory: string,
  command: SaveStash,
  head: string,
  files: readonly ChangedFile[],
) {
  const diff = async (args: readonly string[], paths: readonly string[]) =>
    paths.length === 0
      ? ""
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
      staged: await diff(
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
    unstaged: await diff(
      [],
      files.filter((file) => file.status !== "?").map((file) => file.path),
    ),
    untracked: await createdFilesPatch(
      git,
      {},
      directory,
      created.map((file) => file.path),
    ),
  };
}

async function withTemporaryIndex<Value>(
  git: GitCommandRunner,
  directory: string,
  use: (indexFile: string) => Promise<Value>,
) {
  const index = await runRepositoryGit(git, directory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  const path = `${index.trim()}.rebase-stash-${randomUUID()}`;
  try {
    return await use(path);
  } finally {
    await Promise.all([
      rm(path, { force: true }),
      rm(`${path}.lock`, { force: true }),
    ]);
  }
}

async function buildTree(
  git: GitCommandRunner,
  directory: string,
  indexFile: string,
  from: string | null,
  patches: readonly string[],
) {
  await runRepositoryGit(
    git,
    directory,
    from === null ? ["read-tree", "--empty"] : ["read-tree", `${from}^{tree}`],
    { indexFile },
  );
  for (const patch of patches.filter((text) => text.trim() !== ""))
    await runRepositoryGit(
      git,
      directory,
      ["apply", "--cached", "--3way", "--whitespace=nowarn"],
      { indexFile, input: patch },
    ).catch((error) => {
      throw isGitFailed(error) ? stashRejected("DoesNotFit") : error;
    });
  return (
    await runRepositoryGit(git, directory, ["write-tree"], { indexFile })
  ).trim();
}

async function commitStash(
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
  const commit = async (
    tree: string,
    text: string,
    parents: readonly string[],
  ) =>
    (
      await runRepositoryGit(git, directory, [
        "commit-tree",
        tree,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        text,
      ])
    ).trim();
  const index = await commit(trees.index, `index on ${label}`, [target.base]);
  const untracked =
    trees.untracked === null
      ? null
      : await commit(trees.untracked, `untracked files on ${label}`, []);
  return commit(trees.worktree, message, [
    target.base,
    index,
    ...(untracked === null ? [] : [untracked]),
  ]);
}

async function baseLabel(
  git: GitCommandRunner,
  directory: string,
  target: StashSnapshot,
) {
  const branch =
    target.subject === null
      ? (
          await runRepositoryGit(
            git,
            directory,
            ["symbolic-ref", "--short", "--quiet", "HEAD"],
            { exitCodes: [0, 1] },
          )
        ).trim()
      : (describeStash(target.subject).branch ?? "");
  const commit = (
    await runRepositoryGit(git, directory, [
      "log",
      "-1",
      "--format=%h %s",
      target.base,
      "--",
    ])
  ).trim();
  return { branch: branch === "" ? "(no branch)" : branch, commit };
}
