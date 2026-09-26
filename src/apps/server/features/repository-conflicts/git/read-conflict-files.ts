import type { ConflictFile, WholeFileChoice } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryFileContent } from "#server/domain/repository-comparison.contract";
import { worktreeFile } from "#server/features/repository-changes/git/change-files";
import { conflictFailed } from "#server/features/repository-conflicts/git/conflict-failures";
import {
  conflictKind,
  hasSide,
  readUnmergedEntries,
  type StageEntry,
} from "#server/features/repository-conflicts/git/stage-entries";
import { markerBlocks } from "#server/features/repository-conflicts/regions/conflict-regions";
import { runRepositoryGit } from "#server/repository/access/index";
import {
  binary,
  fingerprint,
  type GitBlob,
  readBlobs,
} from "#server/repository/comparison/index";

export interface ConflictSnapshot {
  readonly file: ConflictFile;
  readonly stages: readonly StageEntry[];
  readonly blobs: ReadonlyMap<string, GitBlob>;
  readonly worktree: RepositoryFileContent;
  readonly markerSize: number;
}

const defaultMarkerSize = 7;
const gitlink = "160000";
const symlink = "120000";

export function readConflictSnapshots(
  git: GitCommandRunner,
  directory: string,
  entries: ReadonlyMap<string, readonly StageEntry[]>,
) {
  return Effect.gen(function* () {
    const paths = [...entries.keys()];
    if (paths.length === 0) return [];
    const markerSizes = yield* readMarkerSizes(git, directory, paths);
    const blobs = yield* readBlobs(
      git,
      directory,
      [...entries.values()].flatMap((stages) =>
        stages.filter((stage) => stage.mode !== gitlink).map(({ oid }) => oid),
      ),
    );
    return yield* Effect.forEach(
      paths,
      (path) =>
        worktreeFile(directory, path).pipe(
          Effect.map((worktree) =>
            conflictSnapshot(
              path,
              entries.get(path) ?? [],
              blobs,
              worktree,
              markerSizes.get(path) ?? defaultMarkerSize,
            ),
          ),
        ),
      { concurrency: 16 },
    );
  });
}

export function requireConflict(
  git: GitCommandRunner,
  directory: string,
  path: string,
  revision?: string,
) {
  return Effect.gen(function* () {
    const stages = (yield* readUnmergedEntries(git, directory, [path])).get(
      path,
    );
    if (stages === undefined)
      return yield* Effect.fail(
        conflictFailed("Missing", "This file is no longer in conflict."),
      );
    const [snapshot] = yield* readConflictSnapshots(
      git,
      directory,
      new Map([[path, stages]]),
    );
    if (snapshot === undefined)
      return yield* Effect.fail(
        conflictFailed("Missing", "This file is no longer in conflict."),
      );
    if (revision !== undefined && snapshot.file.revision !== revision)
      return yield* Effect.fail(
        conflictFailed(
          "Stale",
          "The file changed since it was loaded. Review the refreshed conflict.",
        ),
      );
    return snapshot;
  });
}

export function worktreeText(worktree: RepositoryFileContent) {
  return worktree.content !== null &&
    worktree.mode !== symlink &&
    !binary(worktree.content)
    ? worktree.content.toString("utf8")
    : null;
}

function conflictSnapshot(
  path: string,
  stages: readonly StageEntry[],
  blobs: ReadonlyMap<string, GitBlob>,
  worktree: RepositoryFileContent,
  markerSize: number,
): ConflictSnapshot {
  const kind = conflictKind(stages);
  const text = worktreeText(worktree);
  return {
    stages,
    blobs,
    worktree,
    markerSize,
    file: {
      path,
      revision: fingerprint(
        path,
        stages
          .map((stage) => `${stage.side}:${stage.mode}:${stage.oid}`)
          .join(),
        worktree.identity,
      ),
      kind,
      stages: stages.map((stage) => {
        const blob = blobs.get(stage.oid);
        return {
          side: stage.side,
          oid: stage.oid,
          bytes: blob?.bytes ?? 0,
          binary: binary(blob?.content ?? null),
        };
      }),
      openRegions: text === null ? 0 : markerBlocks(text, markerSize).length,
      choices: wholeFileChoices(stages, kind, worktree),
    },
  };
}

function wholeFileChoices(
  stages: readonly StageEntry[],
  kind: ConflictFile["kind"],
  worktree: RepositoryFileContent,
) {
  const choices: WholeFileChoice[] = [];
  if (hasSide(stages, "current")) choices.push("current");
  if (hasSide(stages, "incoming")) choices.push("incoming");
  if (kind.startsWith("deleted-in-") || kind === "both-deleted")
    choices.push("delete");
  if (worktree.identity !== "missing") choices.push("worktree");
  return choices;
}

function readMarkerSizes(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
) {
  return runRepositoryGit(
    git,
    directory,
    ["check-attr", "-z", "--stdin", "conflict-marker-size"],
    { input: paths.map((path) => `${path}\0`).join("") },
  ).pipe(
    Effect.map((output) => {
      const fields = output.split("\0");
      const sizes = new Map<string, number>();
      for (let index = 0; index + 2 < fields.length; index += 3) {
        const size = Number(fields[index + 2]);
        if (Number.isSafeInteger(size) && size > 0)
          sizes.set(fields[index] ?? "", size);
      }
      return sizes;
    }),
  );
}
