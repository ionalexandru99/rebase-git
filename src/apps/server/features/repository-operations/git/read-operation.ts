import { createHash } from "node:crypto";
import type {
  OperationKind,
  RepositoryOperation,
} from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryOperationError } from "#server/domain/repository-operations.contract";
import { operationError } from "#server/features/repository-operations/git/operation-errors";
import {
  operationFileStamp,
  operationGit,
  readOperationFile,
  resolveOperationDirectories,
} from "#server/features/repository-operations/git/operation-metadata";

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

export function readRepositoryOperation(
  git: GitCommandRunner,
  directory: string,
): Effect.Effect<RepositoryOperation, RepositoryOperationError> {
  return Effect.gen(function* () {
    const { gitDirectory, commonDirectory } =
      yield* resolveOperationDirectories(git, directory);
    const values = yield* Effect.forEach(
      metadataNames,
      (name) => readOperationFile(gitDirectory, name),
      { concurrency: 8 },
    );
    const metadata = Object.fromEntries(
      metadataNames.map((name, index) => [name, values[index] ?? null]),
    );
    const directories = yield* Effect.forEach(
      ["rebase-merge", "rebase-apply", "sequencer"],
      (name) => operationFileStamp(gitDirectory, name),
    );
    const index = yield* operationFileStamp(gitDirectory, "index");
    const lock =
      (yield* operationFileStamp(gitDirectory, "index.lock")) !== null
        ? "index.lock"
        : (yield* operationFileStamp(commonDirectory, "packed-refs.lock")) !==
            null
          ? "packed-refs.lock"
          : null;
    const head = yield* git
      .run({ directory, arguments: ["rev-parse", "--verify", "HEAD"] })
      .pipe(
        Effect.map((output) =>
          output.exitCode === 0 ? output.stdout.trim() : null,
        ),
        Effect.mapError(() =>
          operationError("InspectionFailed", "Could not inspect HEAD."),
        ),
      );
    const kind = identifyOperation(metadata, directories);
    const unresolved =
      kind === "idle"
        ? ""
        : yield* operationGit(git, directory, ["ls-files", "--unmerged", "-z"]);
    const status =
      kind === "idle"
        ? ""
        : yield* operationGit(git, directory, [
            "status",
            "--porcelain=v1",
            "--no-renames",
            "-z",
            "--untracked-files=no",
          ]);
    const worktree = yield* Effect.forEach(
      status.split("\0").filter(Boolean),
      (record) => operationFileStamp(directory, record.slice(3)),
      { concurrency: 16 },
    );
    const unresolvedPaths = [
      ...new Set(
        unresolved
          .split("\0")
          .filter(Boolean)
          .map((line) => line.slice(line.indexOf("\t") + 1)),
      ),
    ].sort();
    const edit =
      kind === "rebase" &&
      metadata["rebase-merge/amend"] !== null &&
      unresolvedPaths.length === 0;
    const phase =
      kind === "idle"
        ? "idle"
        : kind === "unknown"
          ? "blocked"
          : unresolvedPaths.length
            ? "conflicts"
            : edit
              ? "edit"
              : "ready";
    const unstaged = status
      .split("\0")
      .some((line) => line.length > 2 && line[1] !== " " && line[1] !== "?");
    const reason =
      lock !== null
        ? "Git is using this worktree. Check again when it finishes."
        : unresolvedPaths.length
          ? `Resolve and stage ${unresolvedPaths.length} ${unresolvedPaths.length === 1 ? "file" : "files"} to continue.`
          : edit && status.length > 0
            ? "Amend your changes before continuing the rebase."
            : kind === "rebase" && unstaged
              ? "Stage and amend your changes before continuing the rebase."
              : null;
    const actions: RepositoryOperation["actions"][number][] = [];
    if (kind !== "idle" && kind !== "unknown") {
      actions.push({ action: "continue", enabled: reason === null, reason });
      if (
        kind !== "merge" &&
        !edit &&
        (kind !== "rebase" ||
          metadata["rebase-merge/stopped-sha"] !== null ||
          directories[1] !== null)
      )
        actions.push({
          action: "skip",
          enabled: lock === null,
          reason: lock === null ? null : reason,
        });
      actions.push({
        action: "abort",
        enabled: lock === null,
        reason: lock === null ? null : reason,
      });
    }
    const headName =
      metadata["rebase-merge/head-name"] ??
      metadata["rebase-apply/head-name"] ??
      metadata.HEAD;
    return {
      kind,
      phase,
      actions,
      unresolvedPaths,
      lock,
      revision: createHash("sha256")
        .update(
          JSON.stringify({
            values,
            directories,
            index,
            head,
            status,
            unresolved,
            worktree,
            lock,
          }),
        )
        .digest("hex"),
      branch: headName?.includes("refs/heads/")
        ? headName
            .trim()
            .replace(/^ref: /, "")
            .replace(/^refs\/heads\//, "")
        : null,
      commit:
        (
          metadata["rebase-merge/stopped-sha"] ??
          metadata["rebase-apply/original-commit"] ??
          metadata.CHERRY_PICK_HEAD ??
          metadata.REVERT_HEAD
        )?.trim() ?? null,
      progress: operationProgress(metadata),
    };
  });
}

function identifyOperation(
  metadata: Record<string, string | null>,
  directories: readonly (string | null)[],
): OperationKind {
  if (directories[0] !== null) return "rebase";
  if (directories[1] !== null) {
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
  return directories[2] === null ? "idle" : "unknown";
}

function operationProgress(metadata: Record<string, string | null>) {
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
