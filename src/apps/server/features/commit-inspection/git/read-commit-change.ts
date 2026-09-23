import type { InspectCommitDiff } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import { runRepositoryGit } from "#server/repository/access/index";

export interface CommitSide {
  readonly mode: string;
  readonly oid: string;
}

export interface CommitChange {
  readonly path: string;
  readonly previousPath: string;
  readonly status: string;
  readonly before: CommitSide;
  readonly after: CommitSide;
  readonly patch: string | undefined;
}

type RawChange = Omit<CommitChange, "patch">;

const changeStatuses = new Set(["A", "M", "D", "T", "R"]);

export function readCommitChange(
  git: GitCommandRunner,
  command: InspectCommitDiff,
  parentOid: string | null,
) {
  const paths =
    command.previousPath === undefined || command.previousPath === command.path
      ? [command.path]
      : [command.previousPath, command.path];
  if (!paths.every(isTreePath)) return Effect.succeed(undefined);
  return runRepositoryGit(
    git,
    command.worktreePath,
    [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "-r",
      "-z",
      "--raw",
      "--patch",
      "--unified=3",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      ...(parentOid === null ? [] : [parentOid]),
      command.oid,
      "--",
      ...paths,
    ],
    {
      globalArguments: [
        "--no-replace-objects",
        "-c",
        `core.bigFileThreshold=${previewByteLimit}`,
        "-c",
        "diff.suppressBlankEmpty=false",
      ],
    },
  ).pipe(Effect.map((output) => findChange(output, command.path)));
}

function isTreePath(path: string) {
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function findChange(output: string, path: string): CommitChange | undefined {
  const { changes, patch } = splitDiffTree(output);
  const index = changes.findIndex((change) => change.path === path);
  const change = changes[index];
  if (change === undefined || !changeStatuses.has(change.status))
    return undefined;
  const chunk = patchChunks(patch)[patchIndex(changes.slice(0, index))];
  return {
    ...change,
    patch:
      chunk === undefined || /^Binary files /m.test(chunk) ? undefined : chunk,
  };
}

function splitDiffTree(output: string) {
  const changes: RawChange[] = [];
  let offset = 0;
  const field = () => {
    const end = output.indexOf("\0", offset);
    const value = output.slice(offset, end < 0 ? output.length : end);
    offset = end < 0 ? output.length : end + 1;
    return value;
  };
  while (output.startsWith(":", offset)) {
    const [
      beforeMode = "",
      afterMode = "",
      beforeOid = "",
      afterOid = "",
      score = "",
    ] = field().slice(1).split(" ");
    const status = score.slice(0, 1);
    const first = field();
    const path = status === "R" ? field() : first;
    changes.push({
      path,
      previousPath: first,
      status,
      before: { mode: beforeMode, oid: beforeOid },
      after: { mode: afterMode, oid: afterOid },
    });
  }
  return { changes, patch: output.slice(offset + 1) };
}

function patchChunks(patch: string) {
  return patch
    .split(/(?=^diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "));
}

function patchIndex(preceding: readonly RawChange[]) {
  return preceding.reduce(
    (count, change) => count + (change.status === "T" ? 2 : 1),
    0,
  );
}
