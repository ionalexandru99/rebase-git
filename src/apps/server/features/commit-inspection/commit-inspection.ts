import type {
  CommitFile,
  CommitInspection,
  InspectCommit,
  InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type ChangedLines,
  changesFailed,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  gitFailed,
  isGitObjectId,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  type CommitSide,
  readCommitChange,
} from "#server/features/commit-inspection/read-commit-change.ts";
import {
  previewRestore,
  restoreFiles,
} from "#server/features/commit-inspection/restore-files.ts";
import {
  largeFilePaths,
  markLargeFile,
} from "#server/features/repository-lfs/git-lfs.ts";
import { buildChangeDiff } from "#server/repository/comparison/build-change-diff.ts";
import { lineCounts } from "#server/repository/comparison/line-counts.ts";
import {
  diffByteLimit,
  type GitBlob,
  readBlobs,
} from "#server/repository/comparison/read-blobs.ts";
import {
  type RepositoryFileContent,
  resolveLargeFile,
} from "#server/repository/comparison/read-object-file.ts";

const originalObjects = { globalArguments: ["--no-replace-objects"] };
const missingMode = "000000";
const submoduleMode = "160000";

async function inspectCommit(
  git: GitCommandRunner,
  command: InspectCommit,
): Promise<CommitInspection> {
  const metadata = await readMetadata(git, command);
  const files = await readCommitFiles(git, command, metadata.parentOid);
  return {
    ...metadata,
    ...fitFiles(files, Buffer.byteLength(JSON.stringify(metadata))),
  };
}

export function fitFiles(files: readonly CommitFile[], reservedBytes: number) {
  let bytes = reservedBytes;
  const visible = files.filter((file) => {
    bytes += Buffer.byteLength(JSON.stringify(file));
    return bytes < 800_000;
  });
  return { files: visible, truncated: visible.length !== files.length };
}

async function inspectCommitDiff(
  git: GitCommandRunner,
  command: InspectCommitDiff,
) {
  const metadata = await readMetadata(git, command);
  return readChangeDiff(git, command, metadata.parentOid);
}

export async function readChangeDiff(
  git: GitCommandRunner,
  command: InspectCommitDiff,
  parentOid: string | null,
) {
  const change = await readCommitChange(git, command, parentOid);
  if (change === undefined)
    throw changesFailed(
      "Stale",
      "This file is not changed in the selected comparison.",
    );
  const blobs = await readBlobs(
    git,
    command.worktreePath,
    [change.before, change.after].filter(hasBlob).map((side) => side.oid),
    diffByteLimit,
    originalObjects,
  );
  const side = (current: CommitSide, commit: string | null) =>
    resolveLargeFile(
      git,
      command.worktreePath,
      commitFile(current, blobs),
      commit ?? undefined,
    );
  const [before, after] = await Promise.all([
    side(change.before, parentOid),
    side(change.after, command.oid),
  ]);
  return buildChangeDiff(
    command.path,
    `${command.oid}:${parentOid ?? "root"}`,
    before,
    after,
    {
      previousPath: change.previousPath,
      patch: change.patch,
      whole: command.whole,
    },
  );
}

function hasBlob(side: CommitSide) {
  return side.mode !== missingMode && side.mode !== submoduleMode;
}

function commitFile(
  side: CommitSide,
  blobs: ReadonlyMap<string, GitBlob>,
): RepositoryFileContent {
  if (side.mode === missingMode)
    return { content: null, bytes: 0, mode: "0", identity: "missing" };
  if (side.mode === submoduleMode)
    return { content: null, bytes: 0, mode: side.mode, identity: side.oid };
  const blob = blobs.get(side.oid);
  if (blob === undefined)
    throw gitFailed("Failed", "Could not read the file object.");
  return { ...blob, mode: side.mode, identity: side.oid };
}

async function readMetadata(git: GitCommandRunner, command: InspectCommit) {
  if (
    ![
      command.oid,
      ...(command.parentOid === undefined ? [] : [command.parentOid]),
    ].every((oid) => isGitObjectId(oid))
  )
    throw changesFailed("Unsupported", "Select a full commit identity.");
  const output = await runRepositoryGit(
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
    throw repositoryRejected("GitFailed", "Could not read commit metadata.");
  const parents = (parentText ?? "").split(" ").filter(Boolean);
  if (command.parentOid !== undefined && !parents.includes(command.parentOid))
    throw changesFailed(
      "Unsupported",
      "Choose a parent of the selected commit.",
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
}

export async function readCommitFiles(
  git: GitCommandRunner,
  command: InspectCommit,
  parentOid: string | null,
) {
  const compared = [
    "--root",
    "--no-commit-id",
    "-r",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "-M",
    ...(parentOid === null ? [] : [parentOid]),
    command.oid,
    "--",
  ];
  const output = await runRepositoryGit(
    git,
    command.worktreePath,
    ["diff-tree", "--name-status", ...compared],
    { ...originalObjects, maxOutputBytes: 16_000_000 },
  );
  const files = commitFiles(output);
  const [counted, large] = await Promise.all([
    files.length > countedFilesLimit
      ? new Map<string, ChangedLines>()
      : runRepositoryGit(
          git,
          command.worktreePath,
          ["diff-tree", "--numstat", ...compared],
          originalObjects,
        ).then(lineCounts),
    largeFilePaths(
      git,
      command.worktreePath,
      files.map((file) => file.path),
    ),
  ]);
  return files.map(
    (file): CommitFile =>
      markLargeFile({ ...file, lines: counted.get(file.path) ?? null }, large),
  );
}

const countedFilesLimit = 1000;

function commitFiles(output: string) {
  const fields = output.split("\0");
  const files: Omit<CommitFile, "lines" | "lfs">[] = [];
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
}

export function commitInspectionFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = CommitInspectionApi;
  return {
    routes: [
      query(api.inspect, (input, git) => inspectCommit(git, input)),
      query(api.inspectDiff, (input, git) => inspectCommitDiff(git, input)),
      query(api.previewRestore, (input, git) => previewRestore(git, input)),
      command(
        api.restore,
        {
          name: "restore",
          locks: { worktree: "wait" },
          duringOperation: "block",
        },
        (input, git) => restoreFiles(git, input),
      ),
    ],
  };
}
