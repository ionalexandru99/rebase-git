import { createHash } from "node:crypto";
import type { OperationKind, RepositoryOperation } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { runRepositoryGit } from "#server/repository/access/run-repository-git";
import {
  inspectionFailed,
  operationFileStamp,
  readOperationFile,
} from "#server/repository/operation/operation-metadata";

export interface GitDirectories {
  readonly gitDirectory: string;
  readonly commonDirectory: string;
}

const metadataNames = [
  "HEAD",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "MERGE_MSG",
  "AUTO_MERGE",
  "rebase-merge/head-name",
  "rebase-merge/onto",
  "rebase-merge/orig-head",
  "rebase-merge/msgnum",
  "rebase-merge/end",
  "rebase-merge/stopped-sha",
  "rebase-merge/amend",
  "rebase-merge/done",
  "rebase-merge/git-rebase-todo",
  "rebase-apply/rebasing",
  "rebase-apply/applying",
  "rebase-apply/next",
  "rebase-apply/last",
  "rebase-apply/original-commit",
  "rebase-apply/head-name",
  "rebase-apply/onto",
  "sequencer/head",
  "sequencer/todo",
  "sequencer/opts",
] as const;
type Metadata = Record<(typeof metadataNames)[number], string | null>;

const idleWorktree = {
  head: null,
  index: null,
  unresolved: "",
  status: "",
  worktree: [],
};

export function readRepositoryOperation(
  git: GitCommandRunner,
  worktreePath: string,
  directories: GitDirectories,
) {
  return Effect.gen(function* () {
    const { values, metadata, stamps } = yield* readOperationMetadata(
      directories.gitDirectory,
    );
    const lock = yield* readGitLock(directories);
    const kind = identifyOperation(metadata, stamps);
    const worktree =
      kind === "idle"
        ? idleWorktree
        : yield* inspectWorktree(git, worktreePath, directories.gitDirectory);
    const unresolvedPaths = [
      ...new Set(
        worktree.unresolved
          .split("\0")
          .filter(Boolean)
          .map((line) => line.slice(line.indexOf("\t") + 1)),
      ),
    ].sort();
    const edit =
      kind === "rebase" &&
      metadata["rebase-merge/amend"] !== null &&
      unresolvedPaths.length === 0;
    const reason = blockedReason(
      kind,
      lock,
      unresolvedPaths.length,
      edit,
      worktree.status,
    );
    return {
      kind,
      phase: operationPhase(kind, unresolvedPaths.length, edit),
      actions: availableActions(kind, metadata, stamps, edit, lock, reason),
      unresolvedPaths,
      lock,
      revision: createHash("sha256")
        .update(JSON.stringify({ values, stamps, lock, worktree }))
        .digest("hex"),
      branch: branchName(
        metadata["rebase-merge/head-name"] ??
          metadata["rebase-apply/head-name"] ??
          metadata.HEAD,
      ),
      commit:
        (
          metadata["rebase-merge/stopped-sha"] ??
          metadata["rebase-apply/original-commit"] ??
          metadata.CHERRY_PICK_HEAD ??
          metadata.REVERT_HEAD
        )?.trim() ?? null,
      progress: operationProgress(metadata),
    } satisfies RepositoryOperation;
  });
}

function readOperationMetadata(gitDirectory: string) {
  return Effect.gen(function* () {
    const values = yield* Effect.forEach(
      metadataNames,
      (name) => readOperationFile(gitDirectory, name),
      { concurrency: 8 },
    );
    const metadata = Object.fromEntries(
      metadataNames.map((name, index) => [name, values[index] ?? null]),
    ) as Metadata;
    const stamps = yield* Effect.forEach(
      ["rebase-merge", "rebase-apply", "sequencer"],
      (name) => operationFileStamp(gitDirectory, name),
    );
    return { values, metadata, stamps };
  });
}

function readGitLock({ gitDirectory, commonDirectory }: GitDirectories) {
  return Effect.gen(function* () {
    if ((yield* operationFileStamp(gitDirectory, "index.lock")) !== null)
      return "index.lock";
    if (
      (yield* operationFileStamp(commonDirectory, "packed-refs.lock")) !== null
    )
      return "packed-refs.lock";
    return null;
  });
}

function operationPhase(
  kind: OperationKind,
  unresolved: number,
  edit: boolean,
): RepositoryOperation["phase"] {
  if (kind === "idle") return "idle";
  if (kind === "unknown") return "blocked";
  if (unresolved) return "conflicts";
  return edit ? "edit" : "ready";
}

function inspectWorktree(
  git: GitCommandRunner,
  worktreePath: string,
  gitDirectory: string,
) {
  return Effect.gen(function* () {
    const head = yield* inspect(
      git,
      worktreePath,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      [0, 1],
    ).pipe(Effect.map((output) => output.trim() || null));
    const index = yield* operationFileStamp(gitDirectory, "index");
    const unresolved = yield* inspect(git, worktreePath, [
      "ls-files",
      "--unmerged",
      "-z",
    ]);
    const status = yield* inspect(git, worktreePath, [
      "status",
      "--porcelain=v1",
      "--no-renames",
      "-z",
      "--untracked-files=no",
    ]);
    const worktree = yield* Effect.forEach(
      status.split("\0").filter(Boolean),
      (record) => operationFileStamp(worktreePath, record.slice(3)),
      { concurrency: 16 },
    );
    return { head, index, unresolved, status, worktree };
  });
}

function inspect(
  git: GitCommandRunner,
  worktreePath: string,
  args: readonly string[],
  exitCodes?: readonly number[],
) {
  return runRepositoryGit(
    git,
    worktreePath,
    args,
    exitCodes === undefined ? {} : { exitCodes },
  ).pipe(Effect.mapError((error) => inspectionFailed(error.detail)));
}

function identifyOperation(
  metadata: Metadata,
  stamps: readonly (string | null)[],
): OperationKind {
  if (stamps[0] !== null) return "rebase";
  if (stamps[1] !== null) {
    if (metadata["rebase-apply/rebasing"] !== null) return "rebase";
    if (metadata["rebase-apply/applying"] !== null) return "am";
    return "unknown";
  }
  if (metadata.MERGE_HEAD !== null) return "merge";
  if (metadata.CHERRY_PICK_HEAD !== null) return "cherry-pick";
  if (metadata.REVERT_HEAD !== null) return "revert";
  const todo = metadata["sequencer/todo"]?.trimStart();
  if (todo?.startsWith("pick ")) return "cherry-pick";
  if (todo?.startsWith("revert ")) return "revert";
  return stamps[2] === null ? "idle" : "unknown";
}

function blockedReason(
  kind: OperationKind,
  lock: string | null,
  unresolved: number,
  edit: boolean,
  status: string,
) {
  if (lock !== null)
    return "Git is using this worktree. Check again when it finishes.";
  if (unresolved)
    return `Resolve and stage ${unresolved} ${unresolved === 1 ? "file" : "files"} to continue.`;
  if (edit && status.length > 0)
    return "Amend your changes before continuing the rebase.";
  const unstaged = status
    .split("\0")
    .some((line) => line.length > 2 && line[1] !== " " && line[1] !== "?");
  if (kind === "rebase" && unstaged)
    return "Stage and amend your changes before continuing the rebase.";
  return null;
}

function availableActions(
  kind: OperationKind,
  metadata: Metadata,
  stamps: readonly (string | null)[],
  edit: boolean,
  lock: string | null,
  reason: string | null,
): RepositoryOperation["actions"][number][] {
  if (kind === "idle" || kind === "unknown") return [];
  const unlocked = {
    enabled: lock === null,
    reason: lock === null ? null : reason,
  };
  const skippable =
    kind !== "merge" &&
    !edit &&
    (kind !== "rebase" ||
      metadata["rebase-merge/stopped-sha"] !== null ||
      stamps[1] !== null);
  return [
    { action: "continue", enabled: reason === null, reason },
    ...(skippable ? [{ action: "skip" as const, ...unlocked }] : []),
    { action: "abort", ...unlocked },
  ];
}

function branchName(headName: string | null) {
  return headName?.includes("refs/heads/")
    ? headName
        .trim()
        .replace(/^ref: /, "")
        .replace(/^refs\/heads\//, "")
    : null;
}

function operationProgress(metadata: Metadata) {
  const current = Number(
    metadata["rebase-merge/msgnum"] ?? metadata["rebase-apply/next"],
  );
  const total = Number(
    metadata["rebase-merge/end"] ?? metadata["rebase-apply/last"],
  );
  return Number.isSafeInteger(current) &&
    Number.isSafeInteger(total) &&
    current > 0 &&
    total >= current
    ? { current, total }
    : null;
}
