import {
  type CommitFile,
  type CommitInspection,
  changesFailed,
  type InspectCommit,
  type InspectCommitDiff,
  repositoryRejected,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { isGitObjectId } from "#server/domain/git-object-id";
import type { RepositoryFileContent } from "#server/domain/repository-comparison.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  type CommitSide,
  readCommitChange,
} from "#server/features/commit-inspection/git/read-commit-change";
import { runRepositoryGit } from "#server/repository/access/index";
import {
  buildChangeDiff,
  type GitBlob,
  readBlobs,
  unreadableBlob,
} from "#server/repository/comparison/index";

const originalObjects = { globalArguments: ["--no-replace-objects"] };
const missingMode = "000000";
const submoduleMode = "160000";

export function inspectCommit(git: GitCommandRunner, command: InspectCommit) {
  return Effect.gen(function* () {
    const metadata = yield* readMetadata(git, command);
    const files = yield* readFiles(git, command, metadata.parentOid);
    let bytes = Buffer.byteLength(JSON.stringify(metadata));
    const visible = files.filter((file) => {
      bytes += Buffer.byteLength(JSON.stringify(file));
      return bytes < 800_000;
    });
    return {
      ...metadata,
      files: visible,
      truncated: visible.length !== files.length,
    } satisfies CommitInspection;
  });
}

export function inspectCommitDiff(
  git: GitCommandRunner,
  command: InspectCommitDiff,
) {
  return Effect.gen(function* () {
    const metadata = yield* readMetadata(git, command);
    const change = yield* readCommitChange(git, command, metadata.parentOid);
    if (change === undefined)
      return yield* Effect.fail(
        changesFailed(
          "Stale",
          "This file is not changed in the selected comparison.",
        ),
      );
    const blobs = yield* readBlobs(
      git,
      command.worktreePath,
      [change.before, change.after].filter(hasBlob).map((side) => side.oid),
      originalObjects,
    );
    return buildChangeDiff(
      command.path,
      `${command.oid}:${metadata.parentOid ?? "root"}`,
      yield* commitFile(change.before, blobs),
      yield* commitFile(change.after, blobs),
      { previousPath: change.previousPath, patch: change.patch },
    );
  });
}

function hasBlob(side: CommitSide) {
  return side.mode !== missingMode && side.mode !== submoduleMode;
}

function commitFile(
  side: CommitSide,
  blobs: ReadonlyMap<string, GitBlob>,
): Effect.Effect<RepositoryFileContent, RepositoryGitError> {
  if (side.mode === missingMode)
    return Effect.succeed({
      content: null,
      bytes: 0,
      mode: "0",
      identity: "missing",
    });
  if (side.mode === submoduleMode)
    return Effect.succeed({
      content: null,
      bytes: 0,
      mode: side.mode,
      identity: side.oid,
    });
  const blob = blobs.get(side.oid);
  return blob === undefined
    ? unreadableBlob
    : Effect.succeed({ ...blob, mode: side.mode, identity: side.oid });
}

function readMetadata(git: GitCommandRunner, command: InspectCommit) {
  return Effect.gen(function* () {
    if (
      ![
        command.oid,
        ...(command.parentOid === undefined ? [] : [command.parentOid]),
      ].every((oid) => isGitObjectId(oid))
    )
      return yield* Effect.fail(
        changesFailed("Unsupported", "Select a full commit identity."),
      );
    const output = yield* runRepositoryGit(
      git,
      command.worktreePath,
      [
        "show",
        "--no-patch",
        "--no-show-signature",
        "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B%x00",
        `${command.oid}^{commit}`,
        "--",
      ],
      { ...originalObjects, maxOutputBytes: 800_000 },
    );
    const [
      oid,
      parentText,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      message,
    ] = output.split("\0");
    if (
      [
        oid,
        parentText,
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        committerDate,
        message,
      ].some((field) => field === undefined) ||
      oid !== command.oid
    )
      return yield* Effect.fail(
        repositoryRejected("GitFailed", "Could not read commit metadata."),
      );
    const parents = (parentText ?? "").split(" ").filter(Boolean);
    if (command.parentOid !== undefined && !parents.includes(command.parentOid))
      return yield* Effect.fail(
        changesFailed("Unsupported", "Choose a parent of the selected commit."),
      );
    return {
      oid: command.oid,
      parents,
      parentOid: command.parentOid ?? parents[0] ?? null,
      message: message ?? "",
      author: {
        name: authorName ?? "",
        email: authorEmail ?? "",
        date: authorDate ?? "",
      },
      committer: {
        name: committerName ?? "",
        email: committerEmail ?? "",
        date: committerDate ?? "",
      },
    };
  });
}

function readFiles(
  git: GitCommandRunner,
  command: InspectCommit,
  parentOid: string | null,
) {
  return runRepositoryGit(
    git,
    command.worktreePath,
    [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "-r",
      "-z",
      "--name-status",
      "--no-ext-diff",
      "--no-textconv",
      "-M",
      ...(parentOid === null ? [] : [parentOid]),
      command.oid,
      "--",
    ],
    { ...originalObjects, maxOutputBytes: 16_000_000 },
  ).pipe(
    Effect.map((output) => {
      const fields = output.split("\0");
      const files: CommitFile[] = [];
      for (let i = 0; i < fields.length - 1; ) {
        const status = fields[i++]?.[0];
        const first = fields[i++];
        const name = status === "R" ? fields[i++] : first;
        if (name === undefined) continue;
        if (
          status === "A" ||
          status === "M" ||
          status === "D" ||
          status === "T" ||
          status === "R"
        )
          files.push({
            path: name,
            previousPath: status === "R" ? (first ?? null) : null,
            status,
          });
      }
      return files;
    }),
  );
}
