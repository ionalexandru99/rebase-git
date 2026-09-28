import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  OperationKind,
  RepositoryOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

const maximumMetadataBytes = 2 * 1024 * 1024;

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
  "SQUASH_MSG",
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
    const candidate = identifyOperation(metadata, stamps);
    const worktree =
      candidate === "idle"
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
    const kind =
      candidate === "squash" && unresolvedPaths.length === 0
        ? "idle"
        : candidate;
    const edit =
      kind === "rebase" &&
      metadata["rebase-merge/amend"] !== null &&
      unresolvedPaths.length === 0;
    const empty =
      unresolvedPaths.length === 0 &&
      (metadata.CHERRY_PICK_HEAD ?? metadata.REVERT_HEAD) !== null &&
      !hasStagedChanges(worktree.status);
    const reason = empty
      ? (lockedReason(lock) ?? "Nothing to commit. Skip this commit.")
      : blockedReason(
          kind,
          lock,
          unresolvedPaths.length,
          edit,
          worktree.status,
        );
    const progress =
      operationProgress(metadata) ??
      (yield* sequenceProgress(git, worktreePath, metadata, worktree.head));
    return {
      kind,
      phase: empty
        ? "empty"
        : operationPhase(kind, unresolvedPaths.length, edit),
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
        (kind === "merge"
          ? metadata.MERGE_HEAD?.split("\n")[0]
          : kind === "squash"
            ? /^commit ([0-9a-f]+)$/m.exec(metadata.SQUASH_MSG ?? "")?.[1]
            : (metadata["rebase-merge/stopped-sha"] ??
              metadata["rebase-apply/original-commit"] ??
              metadata.CHERRY_PICK_HEAD ??
              metadata.REVERT_HEAD)
        )?.trim() ?? null,
      mergedBranch:
        kind === "merge" ? mergedBranchName(metadata.MERGE_MSG) : null,
      progress,
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
  if (stamps[2] !== null) return "unknown";
  return metadata.SQUASH_MSG === null ? "idle" : "squash";
}

function lockedReason(lock: string | null) {
  return lock === null
    ? null
    : "Git is using this worktree. Check again when it finishes.";
}

function blockedReason(
  kind: OperationKind,
  lock: string | null,
  unresolved: number,
  edit: boolean,
  status: string,
) {
  const locked = lockedReason(lock);
  if (locked !== null) return locked;
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
  if (kind === "squash") return [{ action: "abort", ...unlocked }];
  const skippable =
    kind !== "merge" &&
    !edit &&
    !/no-commit\s*=\s*true/.test(metadata["sequencer/opts"] ?? "") &&
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

function mergedBranchName(message: string | null) {
  return (
    /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(message ?? "")?.[1] ??
    null
  );
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

function hasStagedChanges(status: string) {
  return status
    .split("\0")
    .some((line) => line.length > 2 && line[0] !== " " && line[0] !== "?");
}

function sequenceProgress(
  git: GitCommandRunner,
  worktreePath: string,
  metadata: Metadata,
  head: string | null,
) {
  const start = metadata["sequencer/head"]?.trim();
  const remaining = (metadata["sequencer/todo"] ?? "")
    .split("\n")
    .filter((line) => /^(pick|revert|p|r)\s/.test(line)).length;
  if (
    start === undefined ||
    head === null ||
    remaining === 0 ||
    /no-commit\s*=\s*true/.test(metadata["sequencer/opts"] ?? "")
  )
    return Effect.succeed(null);
  return inspect(git, worktreePath, [
    "rev-list",
    "--count",
    `${start}..${head}`,
  ]).pipe(
    Effect.map((output) => {
      const done = Number(output.trim());
      return Number.isSafeInteger(done)
        ? { current: done + 1, total: done + remaining }
        : null;
    }),
  );
}

function readOperationFile(directory: string, name: string) {
  return Effect.tryPromise({
    try: async () => {
      try {
        const path = join(directory, name);
        if ((await stat(path)).size > maximumMetadataBytes)
          throw new Error("Operation metadata is too large.");
        return await readFile(path, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    catch: () => inspectionFailed(`Could not read Git metadata: ${name}.`),
  });
}

function operationFileStamp(directory: string, name: string) {
  return Effect.tryPromise({
    try: async () => {
      try {
        const info = await lstat(join(directory, name), { bigint: true });
        return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    catch: () => inspectionFailed(`Could not inspect Git metadata: ${name}.`),
  });
}

function inspectionFailed(detail: string) {
  return repositoryRejected("GitFailed", detail);
}

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
