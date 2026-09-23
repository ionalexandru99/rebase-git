import type {
  CommitFile,
  CommitInspection,
  InspectCommit,
  InspectCommitDiff,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { isGitObjectId } from "#server/domain/git-object-id";
import { inspectionError } from "#server/features/commit-inspection/git/inspection-error";
import { runRepositoryGit } from "#server/repository/access/index";
import {
  buildChangeDiff,
  objectFile,
} from "#server/repository/comparison/index";

const originalObjects = { globalArguments: ["--no-replace-objects"] };

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
    const files = yield* readFiles(
      git,
      command,
      metadata.parentOid,
      command.path,
    );
    const file = files.find((file) => file.path === command.path);
    if (file === undefined)
      return yield* Effect.fail(
        inspectionError(
          "Missing",
          "This file is not changed in the selected comparison.",
        ),
      );
    const [before, after] = yield* Effect.all(
      [
        metadata.parentOid === null || file.status === "A"
          ? Effect.succeed({
              content: null,
              bytes: 0,
              mode: "0",
              identity: "missing",
            })
          : objectFile(
              git,
              command.worktreePath,
              file.previousPath ?? file.path,
              { ...originalObjects, tree: metadata.parentOid },
            ),
        file.status === "D"
          ? Effect.succeed({
              content: null,
              bytes: 0,
              mode: "0",
              identity: "missing",
            })
          : objectFile(git, command.worktreePath, file.path, {
              ...originalObjects,
              tree: command.oid,
            }),
      ],
      { concurrency: 2 },
    );
    return buildChangeDiff(
      command.path,
      `${command.oid}:${metadata.parentOid ?? "root"}`,
      before,
      after,
      file.previousPath ?? file.path,
    );
  });
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
        inspectionError("Unsupported", "Select a full commit identity."),
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
        inspectionError("GitFailed", "Could not read commit metadata."),
      );
    const parents = (parentText ?? "").split(" ").filter(Boolean);
    if (command.parentOid !== undefined && !parents.includes(command.parentOid))
      return yield* Effect.fail(
        inspectionError(
          "Unsupported",
          "Choose a parent of the selected commit.",
        ),
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
  path?: string,
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
        if (name === undefined || (path !== undefined && name !== path))
          continue;
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
