import { createHash } from "node:crypto";
import type { RepositoryHistorySnapshot } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { readShallowHistoryOids } from "#server/features/repository-history/git/shallow-repository-history";

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
): Effect.Effect<RepositoryHistorySnapshot, RepositoryHistoryError> {
  return Effect.gen(function* () {
    const [formatOutput, refsOutput, stashTipOutput, worktreesOutput] =
      yield* Effect.all(
        [
          runGit(git, repositoryPath, ["rev-parse", "--show-object-format"]),
          runGit(
            git,
            repositoryPath,
            [
              "for-each-ref",
              `--format=${refFormat}`,
              "refs/heads",
              "refs/remotes",
              "refs/tags",
            ],
            maximumRefsOutputBytes,
          ),
          runGit(git, repositoryPath, [
            "for-each-ref",
            "--format=%(objectname)",
            "refs/stash",
          ]),
          runGit(git, repositoryPath, [
            "worktree",
            "list",
            "--porcelain",
            "-z",
          ]),
        ],
        { concurrency: "unbounded" },
      );
    const objectFormat = yield* parseObjectFormat(formatOutput);
    const shallowOids = yield* readShallowHistoryOids(git, repositoryPath);
    const stashOutput =
      stashTipOutput.trim() === ""
        ? ""
        : yield* runGit(
            git,
            repositoryPath,
            ["reflog", "show", "--format=%H", "refs/stash"],
            maximumStashRootsBytes,
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
      id: snapshotId(objectFormat, targets, rootOids, shallowOids),
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
  objectFormat: "sha1" | "sha256",
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
    if (target === undefined || !isOid(target, objectFormat)) {
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

function parseWorktreeHeads(output: string, objectFormat: "sha1" | "sha256") {
  return output
    .split("\0")
    .filter((field) => field.startsWith("HEAD "))
    .map((field) => field.slice(5))
    .filter((oid) => isOid(oid, objectFormat));
}

function parseOids(output: string, objectFormat: "sha1" | "sha256") {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((oid) => isOid(oid, objectFormat));
}

function snapshotId(
  objectFormat: "sha1" | "sha256",
  refs: RepositoryHistorySnapshot["refTargets"],
  rootOids: readonly string[],
  shallowOids: readonly string[],
) {
  const hash = createHash("sha256");
  hash.update(objectFormat);
  for (const ref of refs) {
    hash.update(`\0${ref.type}\0${ref.name}\0${ref.oid}`);
  }
  for (const oid of rootOids) {
    hash.update(`\0root\0${oid}`);
  }
  for (const oid of shallowOids) hash.update(`\0shallow\0${oid}`);
  return hash.digest("hex");
}

function parseObjectFormat(
  output: string,
): Effect.Effect<"sha1" | "sha256", RepositoryHistoryError> {
  const format = output.trim();
  if (format === "sha1" || format === "sha256") {
    return Effect.succeed(format);
  }
  return Effect.fail(
    new RepositoryHistoryError({
      failure: {
        _tag: "GitFailed",
        detail: `Unsupported Git object format: ${format}`,
        reason: "Failed",
      },
    }),
  );
}

function isOid(oid: string, objectFormat: "sha1" | "sha256") {
  return (
    oid.length === (objectFormat === "sha1" ? 40 : 64) &&
    /^[0-9a-f]+$/.test(oid)
  );
}

function runGit(
  git: GitCommandRunner,
  directory: string,
  arguments_: readonly string[],
  maxOutputBytes?: number,
) {
  return git
    .run({
      arguments: arguments_,
      directory,
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
      timeoutMilliseconds: 30_000,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryHistoryError({
            cause,
            failure: { _tag: "GitFailed", reason: cause.reason },
          }),
      ),
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.succeed(result.stdout)
          : Effect.fail(
              new RepositoryHistoryError({
                failure: {
                  _tag: "GitFailed",
                  detail: result.stderr.slice(0, 2_048),
                  reason: "Failed",
                },
              }),
            ),
      ),
    );
}
