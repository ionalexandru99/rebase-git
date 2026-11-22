import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadChangeDiff } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandOptions,
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import {
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files.ts";
import {
  binary,
  buildChangeDiff,
} from "#server/repository/comparison/build-change-diff.ts";
import { diffByteLimit } from "#server/repository/comparison/read-blobs.ts";
import {
  objectFile,
  resolveLargeFile,
} from "#server/repository/comparison/read-object-file.ts";

export async function readChangeDiff(
  git: GitCommandRunner,
  command: ReadChangeDiff,
  { base, previousPath }: { base: string; previousPath: string | null },
  index: GitCommandOptions = {},
) {
  await safeChangePath(command.worktreePath, command.path);
  const [before, after] = await Promise.all([
    objectFile(
      git,
      command.worktreePath,
      previousPath ?? command.path,
      command.section === "staged" ? { ...index, tree: base } : index,
    ),
    command.section === "staged"
      ? objectFile(git, command.worktreePath, command.path, index)
      : readWorktreeFile(git, command.worktreePath, command.path, index),
  ]);
  return buildChangeDiff(command.path, base, before, after, {
    previousPath: previousPath ?? command.path,
    whole: command.whole,
  });
}

export async function readWorktreeFile(
  git: GitCommandRunner,
  directory: string,
  path: string,
  index: GitCommandOptions = {},
) {
  const working = await worktreeFile(directory, path);
  if (
    !working.mode.startsWith("100") ||
    working.content === null ||
    binary(working.content)
  )
    return working;
  return resolveLargeFile(git, directory, {
    ...working,
    content: await cleanFileContent(
      git,
      index,
      directory,
      path,
      working.content,
    ),
  });
}

async function cleanFileContent(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  path: string,
  content: Buffer,
) {
  if (
    !content.includes(13) &&
    !(await needsCleanFilter(git, index, directory, path))
  )
    return content;
  const objectDirectory = await changeIo(() =>
    mkdtemp(join(tmpdir(), "rebase-scratch-")),
  );
  try {
    const oid = (
      await runRepositoryGit(
        git,
        directory,
        ["hash-object", "-w", `--path=${path}`, "--stdin"],
        { ...index, input: content.toString("utf8"), objectDirectory },
      )
    ).trim();
    return Buffer.from(
      await runRepositoryGit(git, directory, ["cat-file", "blob", oid], {
        ...index,
        objectDirectory,
        outputEncoding: "base64",
        maxOutputBytes: diffByteLimit,
      }),
      "base64",
    );
  } finally {
    await rm(objectDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

const inactiveSafeCrlfValues = new Set(["false", "0", "no", "off", "warn"]);

async function needsCleanFilter(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  path: string,
) {
  const [attributes, safeCrlf] = await Promise.all([
    runRepositoryGit(
      git,
      directory,
      ["check-attr", "-z", "--all", "--", path],
      index,
    ),
    runRepositoryGit(
      git,
      directory,
      ["config", "--default", "false", "--get", "core.safecrlf"],
      index,
    ),
  ]);
  if (!inactiveSafeCrlfValues.has(safeCrlf.trim().toLowerCase())) return true;
  const fields = attributes.split("\0");
  for (let i = 1; i < fields.length; i += 3) {
    const attribute = fields[i];
    if (
      attribute === "filter" ||
      attribute === "ident" ||
      attribute === "working-tree-encoding"
    )
      return true;
  }
  return false;
}
