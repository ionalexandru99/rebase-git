import type { RepositoryHistorySnapshot } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  type GitObjectFormat,
  isGitObjectId,
} from "#server/domain/git-object-id";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import type { RepositoryHistoryError } from "#server/features/repository-history/git/history-failures";
import { historySnapshotIdentity } from "#server/features/repository-history/git/history-snapshot-identity";
import type { ObjectFormatRead } from "#server/features/repository-history/git/read-object-format";
import { readShallowHistoryOids } from "#server/features/repository-history/git/shallow-repository-history";
import { runRepositoryGit } from "#server/repository/access/index";

const maximumRefsOutputBytes = 16 * 1_048_576;
const maximumStashRootsBytes = 16 * 1_024;
const refFormat = [
  "%(refname)",
  "%(objectname)",
  "%(objecttype)",
  "%(*objectname)",
  "%(*objecttype)",
  "%(symref)",
].join("%00");

export function readRepositoryHistorySnapshot(
  git: GitCommandRunner,
  repositoryPath: string,
  readObjectFormat: ObjectFormatRead,
): Effect.Effect<
  RepositoryHistorySnapshot,
  RepositoryHistoryError | RepositoryGitError
> {
  return Effect.gen(function* () {
    const [objectFormat, refsOutput, stashTipOutput, worktreesOutput] =
      yield* Effect.all(
        [
          readObjectFormat,
          runRepositoryGit(
            git,
            repositoryPath,
            [
              "for-each-ref",
              `--format=${refFormat}`,
              "refs/heads",
              "refs/remotes",
              "refs/tags",
            ],
            { maxOutputBytes: maximumRefsOutputBytes },
          ),
          runRepositoryGit(git, repositoryPath, [
            "for-each-ref",
            "--format=%(objectname)",
            "refs/stash",
          ]),
          runRepositoryGit(git, repositoryPath, [
            "worktree",
            "list",
            "--porcelain",
            "-z",
          ]),
        ],
        { concurrency: "unbounded" },
      );
    const shallowOids = yield* readShallowHistoryOids(git, repositoryPath);
    const stashOutput =
      stashTipOutput.trim() === ""
        ? ""
        : yield* runRepositoryGit(
            git,
            repositoryPath,
            ["reflog", "show", "--format=%H", "refs/stash"],
            { maxOutputBytes: maximumStashRootsBytes },
          );
    const refTargets = parseSnapshotRefs(refsOutput, objectFormat);
    const worktreeHeads = parseWorktreeHeads(worktreesOutput, objectFormat);
    const rootOids = [
      ...new Set([
        ...refTargets.map((target) => target.oid),
        ...worktreeHeads,
        ...parseOids(stashOutput, objectFormat),
      ]),
    ].sort();
    const targets = [
      ...refTargets,
      ...worktreeHeads.map((oid, index) => ({
        name: index === 0 ? "HEAD" : `HEAD (${index + 1})`,
        oid,
        type: "head" as const,
      })),
    ].sort((left, right) =>
      compareRefNames(
        `${left.type}\0${left.name}`,
        `${right.type}\0${right.name}`,
      ),
    );
    return {
      id: historySnapshotIdentity(objectFormat, targets, rootOids, shallowOids),
      objectFormat,
      refTargets: targets,
      resumable: true,
      rootOids,
      shallowOids,
    };
  });
}

function compareRefNames(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseSnapshotRefs(
  output: string,
  objectFormat: GitObjectFormat,
): RepositoryHistorySnapshot["refTargets"] {
  const refs: Array<RepositoryHistorySnapshot["refTargets"][number]> = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [name, oid, objectType, peeledOid, peeledType, symbolicTarget] =
      line.split("\0");
    if (name === undefined || symbolicTarget !== "") {
      continue;
    }
    const target =
      objectType === "commit"
        ? oid
        : peeledType === "commit"
          ? peeledOid
          : undefined;
    if (target === undefined || !isGitObjectId(target, objectFormat)) {
      continue;
    }
    if (name.startsWith("refs/heads/")) {
      refs.push({ name: name.slice(11), oid: target, type: "branch" });
    } else if (name.startsWith("refs/remotes/")) {
      refs.push({
        name: name.slice(13),
        oid: target,
        type: "remote-branch",
      });
    } else if (name.startsWith("refs/tags/")) {
      refs.push({ name: name.slice(10), oid: target, type: "tag" });
    }
  }
  return refs;
}

function parseWorktreeHeads(output: string, objectFormat: GitObjectFormat) {
  return output
    .split("\0")
    .filter((field) => field.startsWith("HEAD "))
    .map((field) => field.slice(5))
    .filter((oid) => isGitObjectId(oid, objectFormat));
}

function parseOids(output: string, objectFormat: GitObjectFormat) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((oid) => isGitObjectId(oid, objectFormat));
}
