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

interface SnapshotSources {
  readonly markerSizes: ReadonlyMap<string, number>;
  readonly blobs: ReadonlyMap<string, GitBlob>;
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
    if (entries.size === 0) return [];
    const sources = yield* readSnapshotSources(git, directory, entries);
    return yield* Effect.forEach(
      entries,
      ([path, stages]) =>
        readConflictSnapshot(directory, path, stages, sources),
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
    const entries = yield* readUnmergedEntries(git, directory, [path]);
    const stages = entries.get(path);
    if (stages === undefined)
      return yield* Effect.fail(
        conflictFailed("Missing", "This file is no longer in conflict."),
      );
    const sources = yield* readSnapshotSources(
      git,
      directory,
      new Map([[path, stages]]),
    );
    const snapshot = yield* readConflictSnapshot(
      directory,
      path,
      stages,
      sources,
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

function readSnapshotSources(
  git: GitCommandRunner,
  directory: string,
  entries: ReadonlyMap<string, readonly StageEntry[]>,
) {
  return Effect.all(
    {
      markerSizes: readMarkerSizes(git, directory, [...entries.keys()]),
      blobs: readBlobs(
        git,
        directory,
        [...entries.values()].flatMap((stages) =>
          stages
            .filter((stage) => stage.mode !== gitlink)
            .map(({ oid }) => oid),
        ),
      ),
    },
    { concurrency: "unbounded" },
  );
}

function readConflictSnapshot(
  directory: string,
  path: string,
  stages: readonly StageEntry[],
  sources: SnapshotSources,
) {
  return worktreeFile(directory, path).pipe(
    Effect.map((worktree) => conflictSnapshot(path, stages, worktree, sources)),
  );
}

function conflictSnapshot(
  path: string,
  stages: readonly StageEntry[],
  worktree: RepositoryFileContent,
  { blobs, markerSizes }: SnapshotSources,
): ConflictSnapshot {
  const markerSize = markerSizes.get(path) ?? defaultMarkerSize;
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
          bytes: blob?.bytes ?? 0,
          binary: binary(blob?.content ?? null),
        };
      }),
      openRegions: text === null ? 0 : markerBlocks(text, markerSize).length,
      choices: wholeFileChoices(stages, kind),
    },
  };
}

function wholeFileChoices(
  stages: readonly StageEntry[],
  kind: ConflictFile["kind"],
) {
  const choices: WholeFileChoice[] = [];
  if (hasSide(stages, "current")) choices.push("current");
  if (hasSide(stages, "incoming")) choices.push("incoming");
  if (kind.startsWith("deleted-in-") || kind === "both-deleted")
    choices.push("delete");
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
